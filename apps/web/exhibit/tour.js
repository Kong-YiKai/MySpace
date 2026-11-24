import * as aholo from '@manycore/aholo-viewer';
const host = document.querySelector('#viewer');
const status = document.querySelector('#status');
let viewer, camera, splat, sequence = 0, drag;
let yaw, pitch, x, y;
function reset() { yaw = Math.PI; pitch = -0.07; x = 0; y = 0; }
function update() {
  if (!camera) return;
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  camera.position.set(x, y, 0);
  camera.lookAt(new aholo.Vector3(x + Math.cos(yaw)*Math.cos(pitch), y + Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch)));
  viewer.setCamera(camera);
  viewer.render();
}
function move(forward, side = 0) {
  x = Math.max(-1.8, Math.min(.18, x + forward*Math.cos(yaw) + side*Math.sin(yaw)));
  y = Math.max(-.65, Math.min(.65, y + forward*Math.sin(yaw) - side*Math.cos(yaw)));
  update();
}
async function load(id) {
  const generation = ++sequence;
  status.hidden = false;
  status.textContent = '正在加载 3DGS 客厅…';
  try {
    if (!viewer) {
      viewer = aholo.createViewer('qiju-tour', host, {antialiasing:false,alpha:false});
      camera = new aholo.PerspectiveCamera(65,1,.05,100);
      camera.up.set(0,0,1);
      aholo.setViewerConfig(viewer,{pipeline:{Splatting:{enabled:true},TAA:{enabled:false},Background:{ground:{enabled:false}}}});
      let queued = false;
      viewer.requestRenderHandler = () => { if (!queued) { queued=true; requestAnimationFrame(()=>{queued=false;viewer.render()}); } };
    }
    const response = await fetch('room-'+id+'.spz');
    if (!response.ok) throw Error('资源下载失败');
    const data = await aholo.SplatLoader.parseSplatData(aholo.SplatLoader.SplatFileType.SPZ,new Uint8Array(await response.arrayBuffer()));
    if (generation !== sequence) return;
    const next = await aholo.SplatUtils.createSplat(data);
    if (generation !== sequence) {next.freeGPU();return}
    if (splat) {viewer.getScene().remove(splat); splat.freeGPU();}
    splat=next; viewer.getScene().add(next); update();
    document.querySelectorAll('[data-room]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.room===id)));
    status.hidden=true;
  } catch (error) { if(generation===sequence) status.textContent='无法加载 3D 场景，可切换方案重试或观看下方视频。'; console.error(error); }
}
document.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>load(b.dataset.room));
document.querySelector('#reset').onclick=()=>{reset();update()};
host.onpointerdown=e=>{host.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY]};
host.onpointermove=e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.004;pitch=Math.max(-1,Math.min(1,pitch+(e.clientY-drag[1])*.003));drag=[e.clientX,e.clientY];update()};
host.onlostpointercapture=()=>{drag=null};
host.addEventListener('wheel',e=>{e.preventDefault();move(-Math.sign(e.deltaY)*.12)}, {passive:false});
window.addEventListener('keydown',e=>{const moves={w:[.12,0],s:[-.12,0],a:[0,-.12],d:[0,.12]};if(moves[e.key])move(...moves[e.key])});
window.addEventListener('resize',update);
reset();load('1');
