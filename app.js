const $ = (selector) => document.querySelector(selector);
const state = { items: [], blend: 0, heightMode: 'max', seams: false };
const preview = $('#previewCanvas');
const ctx = preview.getContext('2d');
let renderTimer;

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

async function loadFiles(fileList) {
  const files = [...fileList];
  const error = $('#uploadError');
  error.textContent = '';
  if (files.length < 2 || files.length > 4) {
    error.textContent = `2〜4枚の画像を選択してください（現在 ${files.length}枚）。`;
    return;
  }
  if (files.some(file => !file.type.startsWith('image/'))) {
    error.textContent = '画像ファイルだけを選択してください。';
    return;
  }
  if (files.some(file => file.size > 20 * 1024 * 1024)) {
    error.textContent = '画像は1枚20MB以下にしてください。';
    return;
  }

  try {
    state.items = await Promise.all(files.map((file, index) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const id = crypto.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
        resolve({ id, image, name: file.name, originalIndex: index });
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
      image.src = url;
    })));
    $('#emptyView').hidden = true;
    $('#editorView').hidden = false;
    buildList();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    error.textContent = '読み込めない画像が含まれています。';
  }
}

function buildList() {
  const list = $('#imageList');
  list.innerHTML = '';
  state.items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'image-row';
    row.draggable = true;
    row.dataset.id = item.id;

    const thumb = document.createElement('canvas');
    thumb.width = 84; thumb.height = 58;
    const tctx = thumb.getContext('2d');
    const scale = Math.max(84 / item.image.naturalWidth, 58 / item.image.naturalHeight);
    const w = item.image.naturalWidth * scale, h = item.image.naturalHeight * scale;
    tctx.drawImage(item.image, (84 - w) / 2, (58 - h) / 2, w, h);

    const position = document.createElement('b');
    position.textContent = index + 1;
    const info = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = item.name;
    const size = document.createElement('small'); size.textContent = `${item.image.naturalWidth} × ${item.image.naturalHeight} px`;
    info.append(name, size);
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-label', `${index + 1}番目の画像を並べ替え`);
    row.append(handle, thumb, info, position);

    let touchTargetId = null;
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      touchTargetId = item.id;
      row.classList.add('dragging-touch');
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!touchTargetId || event.pointerType === 'mouse') return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.image-row');
      document.querySelectorAll('.image-row.drop-target').forEach(element => element.classList.remove('drop-target'));
      if (target) {
        touchTargetId = target.dataset.id;
        if (target.dataset.id !== item.id) target.classList.add('drop-target');
      }
    });
    const finishTouchDrag = event => {
      if (!touchTargetId || event.pointerType === 'mouse') return;
      const from = state.items.findIndex(entry => entry.id === item.id);
      const to = state.items.findIndex(entry => entry.id === touchTargetId);
      touchTargetId = null;
      row.classList.remove('dragging-touch');
      document.querySelectorAll('.image-row.drop-target').forEach(element => element.classList.remove('drop-target'));
      if (from >= 0 && to >= 0 && from !== to) {
        const [moved] = state.items.splice(from, 1);
        state.items.splice(to, 0, moved);
        buildList();
        render();
      }
    };
    handle.addEventListener('pointerup', finishTouchDrag);
    handle.addEventListener('pointercancel', finishTouchDrag);

    row.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', item.id);
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.image-row.drop-target').forEach(element => element.classList.remove('drop-target'));
    });
    row.addEventListener('dragover', event => {
      event.preventDefault();
      if (!row.classList.contains('dragging')) {
        document.querySelectorAll('.image-row.drop-target').forEach(element => element.classList.remove('drop-target'));
        row.classList.add('drop-target');
      }
    });
    row.addEventListener('dragleave', event => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target');
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      row.classList.remove('drop-target');
      const sourceId = event.dataTransfer.getData('text/plain');
      const from = state.items.findIndex(entry => entry.id === sourceId);
      const to = state.items.findIndex(entry => entry.id === item.id);
      if (from === to || from < 0) return;
      const [moved] = state.items.splice(from, 1);
      state.items.splice(to, 0, moved);
      buildList(); render();
    });
    list.append(row);
  });
}

function readEdge(image, side) {
  const width = 32;
  const height = 256;
  const sourceWidth = Math.max(8, Math.min(64, Math.round(image.naturalWidth * .05)));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const edgeContext = canvas.getContext('2d', { willReadFrequently: true });
  const sourceX = side === 'left' ? 0 : image.naturalWidth - sourceWidth;
  edgeContext.drawImage(image, sourceX, 0, sourceWidth, image.naturalHeight, 0, 0, width, height);
  return { width, height, pixels: edgeContext.getImageData(0, 0, width, height).data };
}

function pixel(edge, x, y) {
  const offset = (y * edge.width + x) * 4;
  return [edge.pixels[offset], edge.pixels[offset + 1], edge.pixels[offset + 2]];
}

function colorDistance(first, second) {
  return Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) + Math.abs(first[2] - second[2]);
}

function vector(first, second) {
  return [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
}

function edgeDifference(rightEdge, leftEdge) {
  let best = Infinity;
  const rightX = rightEdge.width - 1;
  for (let shift = -5; shift <= 5; shift++) {
    const rowScores = [];
    for (let y = 2; y < rightEdge.height - 2; y++) {
      const otherY = y + shift;
      if (otherY < 2 || otherY >= leftEdge.height - 2) continue;
      const right = pixel(rightEdge, rightX, y);
      const rightNear = pixel(rightEdge, rightX - 2, y);
      const left = pixel(leftEdge, 0, otherY);
      const leftNear = pixel(leftEdge, 2, otherY);
      const seamColor = colorDistance(right, left);
      const horizontalFlow = colorDistance(vector(rightNear, right), vector(left, leftNear));
      const verticalFlow = colorDistance(
        vector(pixel(rightEdge, rightX, y - 2), pixel(rightEdge, rightX, y + 2)),
        vector(pixel(leftEdge, 0, otherY - 2), pixel(leftEdge, 0, otherY + 2))
      );
      const nearTexture = Math.abs(colorDistance(rightNear, right) - colorDistance(left, leftNear));
      rowScores.push(seamColor * .52 + horizontalFlow * .25 + verticalFlow * .18 + nearTexture * .05);
    }
    rowScores.sort((a, b) => a - b);
    const keep = Math.max(1, Math.floor(rowScores.length * .9));
    const score = rowScores.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep;
    best = Math.min(best, score);
  }
  return best;
}

function numberedOrder(items) {
  const parsed = items.map(item => {
    const base = item.name.replace(/\.[^.]+$/, '');
    const match = base.match(/^(.*?)(?:[-_ ]+(?:part|slice|tile|image|img))?[-_ (]+(\d{1,2})\)?$/i);
    return match ? { item, prefix: match[1].toLowerCase(), number: Number(match[2]) } : null;
  });
  if (parsed.some(entry => !entry)) return null;
  if (new Set(parsed.map(entry => entry.prefix)).size !== 1) return null;
  const values = parsed.map(entry => entry.number).sort((a, b) => a - b);
  const startsAtZero = values.every((value, index) => value === index);
  const startsAtOne = values.every((value, index) => value === index + 1);
  if (!startsAtZero && !startsAtOne) return null;
  return parsed.sort((a, b) => a.number - b.number).map(entry => entry.item);
}

function permutations(items) {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, position) => position !== index)).map(rest => [item, ...rest])
  );
}

function autoOrder() {
  if (state.items.length < 2 || state.items.length > 4) return;
  const button = $('#autoOrderBtn');
  button.disabled = true;
  button.textContent = '解析中… (Beta)';
  requestAnimationFrame(() => setTimeout(() => {
    const byNumber = numberedOrder(state.items);
    if (byNumber) {
      state.items = byNumber;
      buildList(); render();
      $('#autoOrderStatus').textContent = '自動で並べ替えました。';
      button.disabled = false;
      button.textContent = '自動で並べ替え (Beta)';
      return;
    }
    const edges = new Map(state.items.map(item => [item.id, {
      left: readEdge(item.image, 'left'), right: readEdge(item.image, 'right')
    }]));
    const differences = state.items.map(item => state.items.map(other => item.id === other.id
      ? Infinity
      : edgeDifference(edges.get(item.id).right, edges.get(other.id).left)));
    const positions = new Map(state.items.map((item, index) => [item.id, index]));
    const candidates = permutations(state.items).map(order => ({
      order,
      score: order.slice(0, -1).reduce((sum, item, index) =>
        sum + differences[positions.get(item.id)][positions.get(order[index + 1].id)], 0)
    })).sort((a, b) => a.score - b.score);
    state.items = candidates[0].order;
    buildList(); render();
    $('#autoOrderStatus').textContent = '自動で並べ替えました。';
    button.disabled = false;
    button.textContent = '自動で並べ替え (Beta)';
  }, 20));
}

function outputGeometry() {
  const heights = state.items.map(item => item.image.naturalHeight);
  const height = state.heightMode === 'min' ? Math.min(...heights) : Math.max(...heights);
  const images = state.items.map(item => ({
    item,
    height,
    width: Math.round(item.image.naturalWidth * height / item.image.naturalHeight)
  }));
  const blend = Math.min(state.blend, ...images.map(entry => Math.floor(entry.width / 3)));
  return { height, images, blend, width: images.reduce((sum, entry) => sum + entry.width, 0) - blend * (images.length - 1) };
}

function render() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (state.items.length < 2) return;
    const geometry = outputGeometry();
    preview.width = geometry.width;
    preview.height = geometry.height;
    ctx.clearRect(0, 0, preview.width, preview.height);
    let x = 0;

    geometry.images.forEach((entry, index) => {
      const image = entry.item.image;
      if (index === 0 || geometry.blend === 0) {
        ctx.drawImage(image, x, 0, entry.width, entry.height);
        x += entry.width;
        return;
      }

      const solidWidth = entry.width - geometry.blend;
      const sourceBlend = geometry.blend / entry.width * image.naturalWidth;
      ctx.drawImage(image, sourceBlend, 0, image.naturalWidth - sourceBlend, image.naturalHeight,
        x, 0, solidWidth, entry.height);

      const layer = document.createElement('canvas');
      layer.width = geometry.blend; layer.height = entry.height;
      const layerCtx = layer.getContext('2d');
      layerCtx.drawImage(image, 0, 0, sourceBlend, image.naturalHeight,
        0, 0, geometry.blend, entry.height);
      layerCtx.globalCompositeOperation = 'destination-in';
      const gradient = layerCtx.createLinearGradient(0, 0, geometry.blend, 0);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,1)');
      layerCtx.fillStyle = gradient;
      layerCtx.fillRect(0, 0, geometry.blend, entry.height);
      ctx.drawImage(layer, x - geometry.blend, 0);
      x += solidWidth;
    });

    if (state.seams) {
      ctx.save(); ctx.strokeStyle = 'red'; ctx.lineWidth = Math.max(2, geometry.width / 800); ctx.setLineDash([12, 8]);
      let seamX = 0;
      geometry.images.slice(0, -1).forEach(entry => {
        seamX += entry.width - geometry.blend;
        ctx.beginPath(); ctx.moveTo(seamX, 0); ctx.lineTo(seamX, geometry.height); ctx.stroke();
      });
      ctx.restore();
    }
    $('#sizeLabel').textContent = `${geometry.width.toLocaleString()} × ${geometry.height.toLocaleString()} px`;
  }, 30);
}

$('#fileInput').addEventListener('change', event => loadFiles(event.target.files));
$('#autoOrderBtn').addEventListener('click', autoOrder);
$('#replaceBtn').addEventListener('click', () => { $('#fileInput').value = ''; $('#fileInput').click(); });
const dropzone = $('#dropzone');
['dragenter', 'dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', event => loadFiles(event.dataTransfer.files));
function setBlend(value) {
  const range = $('#blendRange');
  state.blend = Math.max(Number(range.min), Math.min(Number(range.max), Number(value)));
  range.value = state.blend;
  range.style.setProperty('--range-progress', `${(state.blend - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100}%`);
  $('#blendValue').textContent = `${state.blend} px`;
  $('#blendMinus').disabled = state.blend <= Number(range.min);
  $('#blendPlus').disabled = state.blend >= Number(range.max);
  render();
}

$('#blendRange').addEventListener('input', event => setBlend(event.target.value));
$('#blendMinus').addEventListener('click', () => setBlend(state.blend - 1));
$('#blendPlus').addEventListener('click', () => setBlend(state.blend + 1));
$('#seamToggle').addEventListener('change', event => { state.seams = event.target.checked; render(); });
document.querySelectorAll('[name="heightMode"]').forEach(input => input.addEventListener('change', event => { state.heightMode = event.target.value; render(); }));
$('#saveBtn').addEventListener('click', () => {
  render();
  setTimeout(() => preview.toBlob(blob => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'integrated-illustration.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    notify('PNGを保存しました');
  }, 'image/png'), 60);
});
setBlend(0);
