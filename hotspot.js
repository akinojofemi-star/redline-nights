// "Create a network": the hosting computer becomes a Wi-Fi network of its own, so friends can play LAN games with no
// router, no shared Wi-Fi and no internet. They join that Wi-Fi, and the game shows up in their LAN list as usual
// (browsers open http://<host>:47800, see lan.js).
// - Windows: a Wi-Fi Direct access point in "legacy" mode (any phone or laptop can join it like normal Wi-Fi). It needs
//   no admin rights and no internet connection, and lasts as long as the PowerShell process that holds it, which
//   watches this app and stops when it goes. Microsoft's WiFiDirectLegacyAP sample does the same from C++.
// - Linux: NetworkManager's hotspot (nmcli). The connection is deleted again when the network is turned off.
// - Mac: apps can't create a Wi-Fi network there (Apple removed it in macOS 11), so the lobby walks the player through
//   Internet Sharing instead.
const { spawn, execFile, execFileSync } = require('child_process');
const os = require('os');

const NM_NAME = 'RacingHeritage';
const WIN_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $null = [Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher, Windows.Devices.WiFiDirect, ContentType = WindowsRuntime]
  $null = [Windows.Security.Credentials.PasswordCredential, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $pub = [Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher]::new()
  $adv = $pub.Advertisement
  $adv.IsAutonomousGroupOwnerEnabled = $true
  $adv.LegacySettings.IsEnabled = $true
  $adv.LegacySettings.Ssid = $env:RH_SSID
  $cred = [Windows.Security.Credentials.PasswordCredential]::new()
  $cred.Password = $env:RH_PASS
  $adv.LegacySettings.Passphrase = $cred
  $pub.Start()
  for ($i = 0; $i -lt 100 -and "$($pub.Status)" -eq 'Created'; $i++) { Start-Sleep -Milliseconds 100 }
  if ("$($pub.Status)" -ne 'Started') { [Console]::Out.WriteLine('FAIL ' + $pub.Status); exit 2 }
  [Console]::Out.WriteLine('STARTED')
  while ("$($pub.Status)" -eq 'Started') {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $env:RH_PARENT -ErrorAction SilentlyContinue)) { break }
  }
  [Console]::Out.WriteLine('STOPPED ' + $pub.Status)
  $pub.Stop()
} catch { [Console]::Out.WriteLine('FAIL ' + $_.Exception.Message); exit 1 }
`;

let proc = null, state = { on: false }, onDrop = null;
const ipv4 = () => new Set(Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address));
// the network's own address on this computer: whichever address appears once it is up (else the usual default)
async function newAddress(before, fallback) {
  for (let i = 0; i < 20; i++) {
    const fresh = [...ipv4()].filter(a => !before.has(a));
    if (fresh.length) return fresh[0];
    await new Promise(r => setTimeout(r, 400));
  }
  return ipv4().has(fallback) ? fallback : null;
}

const supported = () => process.platform === 'win32' || process.platform === 'linux';

function startWindows(ssid, pass) {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')],
      { env: { ...process.env, RH_SSID: ssid, RH_PASS: pass, RH_PARENT: String(process.pid) }, windowsHide: true });
    let out = '', done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    p.stdout.on('data', d => {
      out += d;
      if (/STARTED/.test(out)) { proc = p; finish({ ok: true }); }
      const fail = out.match(/FAIL (.*)/);
      if (fail) finish({ ok: false, msg: fail[1].trim() });
    });
    p.on('error', e => finish({ ok: false, msg: e.message }));
    p.on('exit', () => {
      finish({ ok: false, msg: out.trim() || 'Windows stopped the network.' });
      if (proc === p) { proc = null; state = { on: false }; if (onDrop) onDrop(); }
    });
    setTimeout(() => { if (!done) { p.kill(); finish({ ok: false, msg: 'Windows took too long to start the network.' }); } }, 20000);
  });
}
function startLinux(ssid, pass) {
  return new Promise(resolve => {
    execFile('nmcli', ['connection', 'delete', NM_NAME], () =>
      execFile('nmcli', ['device', 'wifi', 'hotspot', 'con-name', NM_NAME, 'ssid', ssid, 'password', pass], { timeout: 30000 },
        (err, so, se) => resolve(err ? { ok: false, msg: String(se || err.message).trim() } : { ok: true })));
  });
}

// start({ssid, pass}, onDrop) -> {ok, ssid, pass, ip} or {ok:false, msg}
async function start({ ssid, pass }, dropped) {
  if (state.on) return state;
  if (!supported()) return { ok: false, msg: 'unsupported' };
  const before = ipv4();
  const r = process.platform === 'win32' ? await startWindows(ssid, pass) : await startLinux(ssid, pass);
  if (!r.ok) return r;
  const ip = await newAddress(before, process.platform === 'win32' ? '192.168.137.1' : '10.42.0.1');
  state = { ok: true, on: true, ssid, pass, ip };
  onDrop = dropped;
  return state;
}
function stop() {
  const was = state.on;
  state = { on: false };
  if (proc) { const p = proc; proc = null; p.kill(); }
  // (waits for it, so quitting the app still takes the network down)
  if (was && process.platform === 'linux') try { execFileSync('nmcli', ['connection', 'delete', NM_NAME], { timeout: 8000 }); } catch {}
  return true;
}

module.exports = { start, stop, supported };
