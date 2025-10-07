import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'

const API_BASE = 'http://localhost:5055'

function useAudioRecorder() {
  const mediaStream = useRef(null)
  const mediaRecorder = useRef(null)
  const chunks = useRef([])
  const listeners = useRef([])
  const levelListeners = useRef([])
  const audioCtx = useRef(null)
  const analyser = useRef(null)
  const levelTimer = useRef(null)

  const start = async () => {
    mediaStream.current = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined
    mediaRecorder.current = new MediaRecorder(mediaStream.current, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    mediaRecorder.current.ondataavailable = e => {
      if (e.data.size) {
        chunks.current.push(e.data)
        listeners.current.forEach(fn => fn(e.data))
      }
    }
    // analyser for mic level
    audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
    const source = audioCtx.current.createMediaStreamSource(mediaStream.current)
    analyser.current = audioCtx.current.createAnalyser()
    analyser.current.fftSize = 1024
    source.connect(analyser.current)
    const data = new Uint8Array(analyser.current.fftSize)
    const tick = () => {
      if (!analyser.current) return
      analyser.current.getByteTimeDomainData(data)
      // RMS level 0..1
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      levelListeners.current.forEach(fn => fn(rms))
    }
    levelTimer.current = setInterval(tick, 50)

    // pass a timeslice so ondataavailable fires periodically (larger chunk aids decoding)
    mediaRecorder.current.start(2000)
  }
  const stop = async () => {
    if (!mediaRecorder.current) return null
    await new Promise(r => { mediaRecorder.current.onstop = r; mediaRecorder.current.stop() })
    mediaStream.current?.getTracks().forEach(t => t.stop())
    if (levelTimer.current) { clearInterval(levelTimer.current); levelTimer.current = null }
    if (audioCtx.current) { try { audioCtx.current.close() } catch {} audioCtx.current = null; analyser.current = null }
    const blob = new Blob(chunks.current, { type: 'audio/webm' })
    const arrayBuffer = await blob.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }
  const requestPermission = async () => {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
    tmp.getTracks().forEach(t => t.stop())
    return true
  }
  const onChunk = (fn) => { listeners.current.push(fn); return () => { listeners.current = listeners.current.filter(f=>f!==fn) } }
  const onLevel = (fn) => { levelListeners.current.push(fn); return () => { levelListeners.current = levelListeners.current.filter(f=>f!==fn) } }
  return { start, stop, onChunk, onLevel, requestPermission }
}

function ConfigModal({ open, initial, onClose, onSave }) {
  const [greeting, setGreeting] = useState(initial.greeting)
  const [goal, setGoal] = useState(initial.goal)
  const [model, setModel] = useState(initial.model)
  if (!open) return null
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3 style={{marginTop:0}}>Set your robot</h3>
        <div style={{display:'grid', gap:10}}>
          <div>
            <label>Greeting message (optional)</label>
            <input maxLength={100} value={greeting} onChange={e=>setGreeting(e.target.value)} placeholder="Hello, world!" />
          </div>
          <div>
            <label>Give your robot a goal</label>
            <textarea rows={4} maxLength={400} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="Speak spanish and try to make fun of another robot..." />
          </div>
          <div>
            <label>Model</label>
            <select value={model} onChange={e=>setModel(e.target.value)}>
              <option>Llama 4 Maverick</option>
              <option>Local Small</option>
              <option>Cloud Powerful</option>
            </select>
          </div>
          <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={()=>onSave({ greeting, goal, model })}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [health, setHealth] = useState(null)
  const [listening, setListening] = useState(false)
  const [inSession, setInSession] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [config, setConfig] = useState({ greeting: 'Hello, world!', goal: '', model: 'Llama 4 Maverick' })
  const [leftMsgs, setLeftMsgs] = useState([])
  const [rightMsgs, setRightMsgs] = useState([])
  const [script, setScript] = useState('hiiiiiii\nhellooooo')
  const recorder = useAudioRecorder()
  const [status, setStatus] = useState('Idle')
  const wsRef = useRef(null)
  const [showDebug, setShowDebug] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [debug, setDebug] = useState([])

  useEffect(() => {
    axios.get(`${API_BASE}/health`).then(r=>setHealth(r.data)).catch(()=>setHealth({ ok:false }))
  }, [])

  const log = (entry) => setDebug(d => [...d.slice(-199), { t: Date.now(), ...entry }])

  const startSession = async () => {
    setInSession(true)
    openWs()
  }
  const endSession = async () => {
    if (listening) {
      await recorder.stop()
      setListening(false)
    }
    setInSession(false)
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
  }

  // WS control using ggwave-cli (sender side real-time)
  const openWs = () => {
    if (wsRef.current) return
    const ws = new WebSocket(`ws://localhost:5055/ws/cli`)
    ws.onopen = () => { setStatus('WS connected (CLI mode)'); log({ type:'ws', msg:'connected' }) }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        log({ type: 'ws_msg', msg })
        if (msg.type === 'decoded' && msg.message) {
          setLeftMsgs(m=>[...m, { role:'user', text: msg.message }])
        } else if (msg.type === 'stderr' && typeof msg.data === 'string') {
          const m = msg.data.match(/Received sound data successfully:\s*'([^']+)'/)
          if (m && m[1]) {
            setLeftMsgs(v=>[...v, { role:'user', text: m[1] }])
          }
        }
      } catch { log({ type:'ws_raw', data: ev.data }) }
    }
    ws.onerror = () => { setStatus('WS error'); log({ type:'ws', msg:'error' }) }
    ws.onclose = () => { setStatus('WS closed'); log({ type:'ws', msg:'closed' }) }
    wsRef.current = ws
  }

  const sendRight = async (text) => {
    setRightMsgs(m => [...m, { role: 'bot', text }])
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type:'send', text }))
      log({ type:'ws_send', text })
      return
    }
    const started = performance.now()
    const resp = await fetch(`${API_BASE}/encode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) })
    const wav = await resp.arrayBuffer()
    log({ type:'http_encode_ms', ms: Math.round(performance.now()-started) })
    const audio = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })))
    await new Promise(resolve => { audio.onended = resolve; audio.play() })
  }

  const playScriptSequentially = async () => {
    const lines = script.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
    for (const line of lines) {
      await sendRight(line)
      await new Promise(r => setTimeout(r, 300))
    }
  }

  const uploadForDecode = async (file) => {
    const form = new FormData()
    form.append('file', file)
    const started = performance.now()
    const r = await fetch(`${API_BASE}/decode`, { method: 'POST', body: form })
    const j = await r.json()
    log({ type:'http_decode_ms', ms: Math.round(performance.now()-started), message: j.message })
    setLeftMsgs(m => [...m, { role: 'user', text: j.message || '(no message detected)' }])
  }

  return (
    <div style={{height: '100%'}}>
      {!inSession ? (
        <div className="center">
          <div style={{textAlign:'center', position:'relative'}}>
            <div className="pill" onClick={()=>setModalOpen(true)} title="Tap to change" />
            <div className="bar" style={{width: 360}}>
              <button className="btn" onClick={()=>setModalOpen(true)} style={{marginRight:8}}>Configure</button>
              <button className="btn primary" onClick={startSession}>Start</button>
            </div>
            <div style={{marginTop: 16, color:'#9ca3af'}}>{health ? (health.ok ? 'Ready' : 'Server not ready') : 'Checking...'}</div>
          </div>
        </div>
      ) : (
        <div className="chat">
          <div className="pane">
            <div className="header"><div>Listener Bot</div><div>
              <input type="file" accept="audio/wav" onChange={e=>e.target.files?.[0] && uploadForDecode(e.target.files[0])} />
              <button className="btn" style={{marginLeft:8}} onClick={async()=>{
                if (!listening) {
                  try {
                    setStatus('Requesting microphone permission...')
                    await recorder.requestPermission()
                    setStatus('Listening...')
                    await recorder.start()
                    recorder.onLevel((lvl)=> setMicLevel(lvl))
                  } catch (e) {
                    setStatus('Microphone permission denied or unavailable')
                    alert('Microphone permission is required. If blocked, allow mic for this site (localhost) or use HTTPS.')
                    return
                  }
                  recorder.onChunk(async (blob)=>{
                    const form = new FormData()
                    form.append('file', blob, 'chunk.webm')
                    try {
                      const t0 = performance.now()
                      const r = await fetch(`${API_BASE}/decode-webm`, { method:'POST', body: form })
                      const j = await r.json()
                      log({ type:'decode_webm_ms', ms: Math.round(performance.now()-t0), message: j.message })
                      if (j.message) setLeftMsgs(m=>[...m, { role:'user', text: j.message }])
                    } catch (err) {
                      log({ type:'decode_webm_err', err: String(err) })
                    }
                  })
                  setListening(true)
                } else {
                  await recorder.stop()
                  setStatus('Stopped')
                  setListening(false)
                }
              }}>{listening ? 'Stop Listening' : 'Start Listening'}</button>
            </div></div>
            <div className="messages">
              {leftMsgs.map((m,i)=>(<div key={i} className="msg">{m.text}</div>))}
            </div>
            <div style={{display:'flex', gap:8}}>
              <button className="btn" onClick={endSession}>End</button>
              <button className="btn" onClick={()=>setShowDebug(s=>!s)}>{showDebug ? 'Hide' : 'Show'} Debug</button>
            </div>
            <div style={{marginTop:8, color:'#9ca3af', fontSize:12}}>Status: {status}</div>
            {showDebug && (
              <div style={{marginTop:8}}>
                <div style={{fontSize:12, color:'#9ca3af'}}>Mic level</div>
                <div style={{height:10, background:'#1f1f24', borderRadius:6}}>
                  <div style={{height:'100%', width:`${Math.min(100, Math.round(micLevel*200))}%`, background:'#7c3aed', borderRadius:6}} />
                </div>
                <div style={{marginTop:8, maxHeight:180, overflow:'auto', fontSize:12, background:'#0f0f12', border:'1px solid #2a2a2e', borderRadius:8, padding:8}}>
                  {debug.slice().reverse().map((e,i)=> (
                    <div key={i} style={{marginBottom:4}}>
                      <code>{JSON.stringify(e)}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="pane">
            <div className="header"><div>Speaker Bot</div><div>
              <button className="btn" onClick={()=>setModalOpen(true)}>Config</button>
            </div></div>
            <div className="messages">
              {rightMsgs.map((m,i)=>(<div key={i} className="msg">{m.text}</div>))}
            </div>
            <div style={{display:'grid', gap:8}}>
              <Composer onSend={sendRight} />
              <div>
                <label style={{fontSize:12,color:'#9ca3af'}}>Conversation script (one line per message)</label>
                <textarea rows={4} value={script} onChange={e=>setScript(e.target.value)} placeholder={'hello\nworld'} />
              </div>
              <div style={{display:'flex', gap:8}}>
                <button className="btn primary" onClick={playScriptSequentially}>Play Script</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfigModal open={modalOpen} initial={config} onClose={()=>setModalOpen(false)} onSave={(c)=>{ setConfig(c); setModalOpen(false) }} />
    </div>
  )
}

function Composer({ onSend }) {
  const [text, setText] = useState('hiiiiiii')
  return (
    <div style={{display:'flex', gap:8}}>
      <input value={text} onChange={e=>setText(e.target.value)} placeholder="Type a message" />
      <button className="btn primary" onClick={()=> onSend(text)}>Send</button>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)


