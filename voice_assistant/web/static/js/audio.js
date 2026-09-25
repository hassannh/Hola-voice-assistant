/**
 * audio.js — Browser microphone test & waveform visualizer module
 * Exposes: AudioModule (global)
 */
const AudioModule = (() => {
  // ── Private state ──────────────────────────────────────────────
  let _isMicTesting = false;
  let _mediaStream  = null;
  let _audioCtx     = null;
  let _analyser     = null;
  let _animFrame    = null;
  let _peakLevel    = 0;

  // ── DOM refs (resolved lazily after DOMContentLoaded) ──────────
  const el = () => ({
    canvas     : document.getElementById("waveformCanvas"),
    meterFill  : document.getElementById("meterFill"),
    meterPeak  : document.getElementById("meterPeak"),
    volDbLabel : document.getElementById("volDbLabel"),
    statusMsg  : document.getElementById("orbStatusMessage"),
    testBtn    : document.getElementById("testMicBtn"),
    testTxt    : document.getElementById("testMicText"),
  });

  // ── Meter UI ───────────────────────────────────────────────────
  function updateMeter(norm) {
    const d = el();
    norm = Math.max(0, Math.min(1, norm));
    const pct = (norm * 100).toFixed(1);
    d.meterFill.style.width = `${pct}%`;

    _peakLevel = norm > _peakLevel ? norm : Math.max(0, _peakLevel - 0.02);
    d.meterPeak.style.left = `${(_peakLevel * 100).toFixed(1)}%`;

    d.volDbLabel.textContent =
      norm <= 0.005
        ? "-∞ dB"
        : `${(20 * Math.log10(norm * 1.5 + 0.001)).toFixed(1)} dB`;
  }

  // ── Synthetic waveform (backend/idle animation) ────────────────
  function drawSynthetic(activity = 0) {
    if (_isMicTesting) return;
    const canvas = el().canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.strokeStyle = activity > 0.02 ? "#06b6d4" : "rgba(255,255,255,0.15)";
    ctx.beginPath();
    const sw = W / 64;
    for (let i = 0; i < 64; i++) {
      const freq = activity > 0
        ? Math.sin(i * 0.35 + Date.now() * 0.01) * activity * (H / 2.2)
        : 0;
      const y = H / 2 + freq;
      i === 0 ? ctx.moveTo(i * sw, y) : ctx.lineTo(i * sw, y);
    }
    ctx.stroke();
  }

  // ── Real mic frame render ──────────────────────────────────────
  function _renderFrame() {
    if (!_isMicTesting || !_analyser) return;
    const data = new Uint8Array(_analyser.frequencyBinCount);
    _analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms  = Math.sqrt(sum / data.length);
    const norm = Math.min(1.0, rms * 4.5);
    updateMeter(norm);

    const canvas = el().canvas;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = norm > 0.05 ? "#10b981" : "#06b6d4";
    ctx.beginPath();
    const sw = W / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = (v * H) / 2;
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sw, y);
    }
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    _animFrame = requestAnimationFrame(_renderFrame);
  }

  // ── Public API ─────────────────────────────────────────────────
  async function startMicTest() {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === "suspended") await _audioCtx.resume();

      _mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });

      const source = _audioCtx.createMediaStreamSource(_mediaStream);
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 512;
      _analyser.smoothingTimeConstant = 0.5;
      source.connect(_analyser);

      _isMicTesting = true;
      const d = el();
      d.testBtn.classList.add("active");
      d.testTxt.textContent = "Stop Mic Test";
      d.statusMsg.textContent = "Live Microphone Monitoring · Speak to verify audio levels";
      UIModule.showToast("Live mic test active — speaking will reflect immediately");
      _renderFrame();
    } catch (err) {
      console.error("Mic test error:", err);
      UIModule.showToast("Microphone permission denied or device error: " + err.message);
      stopMicTest();
    }
  }

  function stopMicTest(isRunning = false) {
    _isMicTesting = false;
    const d = el();
    d.testBtn.classList.remove("active");
    d.testTxt.textContent = "Test Mic";
    d.statusMsg.textContent = isRunning
      ? "Voice loop active · Listening for speech"
      : "Ready · Press 'Start Assistant' or type below";

    if (_animFrame) cancelAnimationFrame(_animFrame);
    _mediaStream?.getTracks().forEach((t) => t.stop());
    _mediaStream = null;
    _audioCtx?.close();
    _audioCtx = null;
    updateMeter(0);
    drawSynthetic(0);
  }

  function toggle(isRunning) {
    _isMicTesting ? stopMicTest(isRunning) : startMicTest();
  }

  function isTesting() { return _isMicTesting; }

  return { updateMeter, drawSynthetic, toggle, stopMicTest, isTesting };
})();
