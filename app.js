/**
 * 运动记录App - 主逻辑 v3
 * 功能：步数统计、GPS跑步追踪（高德地图）、历史记录、统计数据、PWA自动更新
 * 新增：语音播报、备注编辑、数据导出、加载状态
 */

// ============ 配置 ============
const STORAGE_KEY = 'exercise_data_v3';
const SETTINGS_KEY = 'exercise_settings_v3';
const LAST_RUN_KEY = 'last_run_settings';
const AMAP_KEY_STORAGE = 'amap_api_key';

const DEFAULT_SETTINGS = {
    stepTarget: 10000,
    stepLength: 70,
    amapKey: '',
    autoAnnounce: true,
    mapProvider: 'amap'
};

const DEFAULT_LAST_RUN = {
    autoAnnounce: true,
    musicReminder: false,
    lastDate: null
};

// ============ 状态 ============
let stepCount = 0;
let lastAcceleration = { x: 0, y: 0, z: 0 };
let isStepDetecting = false;
let stepDetectionThreshold = 18;
let simulatedSteps = 0;
let lastStepTime = 0;
const STEP_COOLDOWN_MS = 300;
const MIN_ACCELERATION_CHANGE = 1.5;

let isRunning = false;
let runStartTime = null;
let runWatchId = null;
let runPath = [];
let runDistance = 0;
let lastPosition = null;
let runTimer = null;
let amapMap = null;
let amapPolyline = null;
let amapStartMarker = null;
let amapEndMarker = null;
let amapCurrentMarker = null;
let amap跑步路径 = [];

// ============ OSM (OpenStreetMap) 地图变量 ============
let osmMap = null;
let osmPolyline = null;
let osmStartMarker = null;
let osmCurrentMarker = null;

let lastAnnouncedKm = 0;
let currentRunId = null;
let currentEditingRunId = null;

// ============ 数据存储 ============
function getData() {
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        return d ? JSON.parse(d) : { records: [], runs: [] };
    } catch (e) {
        console.error('获取数据失败:', e);
        return { records: [], runs: [] };
    }
}

function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('保存数据失败:', e);
    }
}

function getSettings() {
    try {
        const s = localStorage.getItem(SETTINGS_KEY);
        return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.error('保存设置失败:', e);
    }
}

function getLastRunSettings() {
    try {
        const s = localStorage.getItem(LAST_RUN_KEY);
        return s ? { ...DEFAULT_LAST_RUN, ...JSON.parse(s) } : { ...DEFAULT_LAST_RUN };
    } catch (e) {
        return { ...DEFAULT_LAST_RUN };
    }
}

function saveLastRunSettings(settings) {
    try {
        localStorage.setItem(LAST_RUN_KEY, JSON.stringify({
            ...settings,
            lastDate: new Date().toISOString()
        }));
    } catch (e) {
        console.error('保存跑步设置失败:', e);
    }
}

function getAmapKey() {
    const settings = getSettings();
    return settings.amapKey || localStorage.getItem(AMAP_KEY_STORAGE) || '';
}

// ============ Toast 通知 ============
function showToast(message, icon = '✅', duration = 2500) {
    const toast = document.getElementById('globalToast');
    const msgEl = document.getElementById('toastMessage');
    const iconEl = document.getElementById('toastIcon');
    if (!toast) return;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.textContent = icon;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

// ============ 步数检测 ============
function startStepDetection() {
    if (isStepDetecting) return;

    if ('DeviceMotionEvent' in window) {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            // iOS 13+: 需要用户授权
            console.log('iOS设备，步数检测需要用户授权');
            document.addEventListener('click', requestIOSStepPermission, { once: true });
        } else {
            enableStepDetection();
        }
    } else {
        console.log('设备不支持步数检测');
    }
}

async function requestIOSStepPermission() {
    try {
        const permission = await DeviceMotionEvent.requestPermission();
        if (permission === 'granted') {
            enableStepDetection();
            showToast('步数检测已授权', '✅');
        }
    } catch (e) {
        console.warn('步数授权失败:', e);
        showToast('步数授权失败，请在设置中开启', '⚠️');
    }
}

function enableStepDetection() {
    isStepDetecting = true;
    window.addEventListener('devicemotion', handleDeviceMotion, { passive: true });
    console.log('步数检测已启动');
}

function handleDeviceMotion(event) {
    if (isRunning) return;
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const { x, y, z } = acc;
    const delta = Math.sqrt(
        Math.pow(x - lastAcceleration.x, 2) +
        Math.pow(y - lastAcceleration.y, 2) +
        Math.pow(z - lastAcceleration.z, 2)
    );

    // 冷却时间内不计数
    if (Date.now() - lastStepTime < STEP_COOLDOWN_MS) {
        lastAcceleration = { x, y, z };
        return;
    }

    if (delta > stepDetectionThreshold && delta < 50 && delta > MIN_ACCELERATION_CHANGE) {
        stepCount++;
        lastStepTime = Date.now();
        updateStepDisplay();
    }

    lastAcceleration = { x, y, z };
}

// 桌面端模拟步数
function simulateSteps() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        console.log('移动设备，不进行步数模拟');
        return;
    }
    console.log('桌面设备，运行步数模拟');
    
    // 立即执行一次，让用户立刻看到效果
    setTimeout(() => {
        if (!isRunning && stepCount === 0) {
            const add = Math.floor(Math.random() * 20) + 10; // 初始给10-30步
            stepCount += add;
            simulatedSteps += add;
            updateStepDisplay();
            console.log('初始步数模拟:', add);
        }
    }, 1000);
    
    // 定期模拟
    setInterval(() => {
        if (!isRunning) {
            const add = Math.floor(Math.random() * 8) + 2;
            stepCount += add;
            simulatedSteps += add;
            updateStepDisplay();
            console.log('步数增加:', add, '总计:', stepCount);
        }
    }, 4000);
}

// ============ 语音播报 ============
function announceDistance(km) {
    if (!('speechSynthesis' in window)) return;
    const settings = getSettings();
    if (!settings.autoAnnounce) return;

    const autoAnnounceToggle = document.getElementById('autoAnnounceToggle');
    if (autoAnnounceToggle && !autoAnnounceToggle.checked) return;

    // 防止重复播报
    if (km <= lastAnnouncedKm) return;
    lastAnnouncedKm = Math.floor(km);

    // 过滤噪音（GPS跳动）
    if (km < lastAnnouncedKm + 0.8) return;

    const text = `已完成 ${Math.floor(km)} 公里，继续加油！`;
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.1;
        utterance.pitch = 1.0;
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn('语音播报失败:', e);
    }
}

// 音乐切换提示（模拟）
function suggestMusicSwitch() {
    const musicToggle = document.getElementById('musicReminderToggle');
    if (musicToggle && musicToggle.checked) {
        showToast('🎵 建议切换到运动音乐', '🎵', 3000);
    }
}

// ============ GPS跑步 ============
async function startRun() {
    console.log('开始跑步被调用');

    if (!navigator.geolocation) {
        showToast('您的设备不支持GPS定位', '⚠️');
        return;
    }

    // 恢复上次跑步设置
    const lastRun = getLastRunSettings();
    const autoAnnounceToggle = document.getElementById('autoAnnounceToggle');
    const musicReminderToggle = document.getElementById('musicReminderToggle');
    if (autoAnnounceToggle) autoAnnounceToggle.checked = lastRun.autoAnnounce;
    if (musicReminderToggle) musicReminderToggle.checked = lastRun.musicReminder;

    isRunning = true;
    runStartTime = Date.now();
    runPath = [];
    runDistance = 0;
    lastPosition = null;
    amap跑步路径 = [];
    lastAnnouncedKm = 0;
    runTimer = setInterval(updateRunTime, 1000);
    updateRunTime(); // Immediate update

    const settings = getSettings();
    if (settings.mapProvider === 'osm') {
        // OpenStreetMap
        const amapContainer = document.getElementById('amapContainer');
        const osmContainer = document.getElementById('osmContainer');
        if (amapContainer) amapContainer.style.display = 'none';
        if (osmContainer) osmContainer.style.display = 'block';
        initOSMMap();
    } else {
        // 高德地图（默认）
        const amapContainer = document.getElementById('amapContainer');
        const osmContainer = document.getElementById('osmContainer');
        if (amapContainer) amapContainer.style.display = 'block';
        if (osmContainer) osmContainer.style.display = 'none';
        initAmapMap();
    }

    const runModal = document.getElementById('runModal');
    if (runModal) {
        runModal.style.display = 'flex';
        document.body.classList.add('running');
    }

    runWatchId = navigator.geolocation.watchPosition(
        updateRunPosition,
        handleGeoError,
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    console.log('跑步模式已启动');
}

function initAmapMap() {
    if (typeof AMap === 'undefined') {
        console.warn('高德地图 SDK 未加载');
        const status = document.getElementById('gpsStatus');
        if (status) status.textContent = '⚠️ 高德地图 SDK 加载中...';
        return;
    }

    try {
        const container = document.getElementById('amapContainer');
        if (!container) return;

        amapMap = new AMap.Map('amapContainer', {
            zoom: 17,
            pitch: 0,
            viewMode: '2D',
            mapStyle: 'amap://styles/normal',
            center: [116.397428, 39.90923],
            resizeEnable: true
        });

        amapMap.addControl(new AMap.Scale());
        amapMap.addControl(new AMap.ToolBar({ position: 'RB' }));

        amapPolyline = new AMap.Polyline({
            strokeColor: '#667eea',
            strokeWeight: 6,
            strokeOpacity: 0.9,
            lineJoin: 'round'
        });
        amapMap.add(amapPolyline);

        const status = document.getElementById('gpsStatus');
        if (status) {
            status.textContent = '📡 GPS定位中...';
            status.classList.remove('active');
        }
    } catch (e) {
        console.error('高德地图初始化失败:', e);
    }
}

function initOSMMap() {
    const container = document.getElementById('osmContainer');
    if (!container) return;

    // 销毁旧地图实例
    if (osmMap) {
        try { osmMap.remove(); } catch (e) {}
        osmMap = null;
    }

    // 初始化 Leaflet 地图
    osmMap = L.map('osmContainer').setView([0, 0], 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(osmMap);

    // 初始化轨迹线
    osmPolyline = L.polyline([], {color: '#667eea', weight: 6}).addTo(osmMap);
    osmStartMarker = null;
    osmCurrentMarker = null;

    const status = document.getElementById('gpsStatus');
    if (status) {
        status.textContent = '📡 GPS定位中...';
        status.classList.remove('active');
    }
}

function updateOSMPosition(lat, lng) {
    if (!osmMap) initOSMMap();
    if (!osmMap) return;

    // 移动地图中心
    osmMap.setView([lat, lng], 17);

    // 添加或更新当前位置标记
    if (osmCurrentMarker) {
        osmCurrentMarker.setLatLng([lat, lng]);
    } else {
        osmCurrentMarker = L.circleMarker([lat, lng], {
            radius: 8,
            fillColor: '#667eea',
            color: '#fff',
            weight: 2
        }).addTo(osmMap);
    }

    // 更新轨迹线
    const path = getRunPath();
    osmPolyline.setLatLngs(path.map(p => [p.lat, p.lng]));
}

function getRunPath() {
    return runPath;
}

function updateRunPosition(position) {
    const { latitude, longitude, speed, accuracy } = position.coords;
    const currentPos = { lat: latitude, lng: longitude, time: Date.now() };

    const status = document.getElementById('gpsStatus');
    if (status) {
        status.textContent = '📍 GPS已定位';
        status.classList.add('active');
    }

    if (lastPosition) {
        const dist = haversineDistance(lastPosition, currentPos);
        // GPS精度过滤
        if (dist < 100 && accuracy < 50) {
            runDistance += dist;
            // 每公里播报
            const km = runDistance / 1000;
            announceDistance(km);
            // 音乐提示（每3公里）
            if (Math.floor(km) > 0 && Math.floor(km) % 3 === 0 && Math.floor(km) !== lastAnnouncedKm) {
                suggestMusicSwitch();
            }
        }
    }

    runPath.push(currentPos);
    lastPosition = currentPos;

    // 根据地图类型更新对应地图
    const settings = getSettings();
    if (settings.mapProvider === 'osm') {
        // 更新 OpenStreetMap
        if (!osmStartMarker && runPath.length === 1) {
            osmStartMarker = L.circleMarker([latitude, longitude], {
                radius: 8,
                fillColor: '#48bb78',
                color: '#fff',
                weight: 2
            }).addTo(osmMap);
        }
        updateOSMPosition(latitude, longitude);
    } else {
        // 更新高德地图
        if (amapMap) {
            const lngLat = new AMap.LngLat(longitude, latitude);
            amap跑步路径.push(lngLat);
            amapPolyline.setPath(amap跑步路径);

            if (!amapStartMarker && amap跑步路径.length === 1) {
                amapStartMarker = new AMap.Marker({
                    position: lngLat,
                    icon: new AMap.Icon({
                        size: new AMap.Size(24, 24),
                        image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#48bb78"/><text x="12" y="16" text-anchor="middle" font-size="12">🚩</text></svg>')
                    })
                });
                amapMap.add(amapStartMarker);
            }

            if (amapCurrentMarker) amapMap.remove(amapCurrentMarker);
            amapCurrentMarker = new AMap.Marker({
                position: lngLat,
                icon: new AMap.Icon({
                    size: new AMap.Size(20, 20),
                    image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#fc8181"/><text x="10" y="14" text-anchor="middle" font-size="10">🏃</text></svg>')
                })
            });
            amapMap.add(amapCurrentMarker);
            amapMap.setCenter(lngLat);
        }
    }

    updateRunStats();
}

function haversineDistance(pos1, pos2) {
    const R = 6371000;
    const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
    const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function updateRunTime() {
    if (!runStartTime) return;
    const elapsed = Math.floor((Date.now() - runStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const el = document.getElementById('runTime');
    if (el) {
        el.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
}

function updateRunStats() {
    const distanceKm = runDistance / 1000;
    const elapsedMin = (Date.now() - runStartTime) / 1000 / 60;
    const pace = distanceKm > 0.01 ? (elapsedMin / distanceKm) : 0;
    const speed = elapsedMin > 0 ? (distanceKm / elapsedMin * 60) : 0;

    const paceMin = Math.floor(pace);
    const paceSec = Math.round((pace - paceMin) * 60);

    const dEl = document.getElementById('runDistance');
    const pEl = document.getElementById('runPace');
    const sEl = document.getElementById('runSpeed');

    if (dEl) dEl.textContent = distanceKm.toFixed(2);
    if (pEl) pEl.textContent = pace > 0 ? `${paceMin}:${String(paceSec).padStart(2, '0')}` : '--:--';
    if (sEl) sEl.textContent = speed.toFixed(1);
}

function handleGeoError(error) {
    console.warn('GPS错误:', error.message);
    const status = document.getElementById('gpsStatus');
    if (status) {
        const msgs = { 1: '位置权限被拒绝', 2: '无法获取位置', 3: '定位超时' };
        status.textContent = '⚠️ ' + (msgs[error.code] || '定位失败');
        status.classList.remove('active');
    }
}

function stopRun() {
    console.log('停止跑步被调用');
    if (!isRunning) return;

    // 保存跑步设置
    const autoAnnounceToggle = document.getElementById('autoAnnounceToggle');
    const musicReminderToggle = document.getElementById('musicReminderToggle');
    saveLastRunSettings({
        autoAnnounce: autoAnnounceToggle ? autoAnnounceToggle.checked : true,
        musicReminder: musicReminderToggle ? musicReminderToggle.checked : false
    });

    isRunning = false;
    if (runTimer) { clearInterval(runTimer); runTimer = null; }
    if (runWatchId) { navigator.geolocation.clearWatch(runWatchId); runWatchId = null; }

    if (runDistance > 10) {
        const data = getData();
        const run = {
            id: Date.now(),
            type: 'run',
            date: new Date().toISOString().split('T')[0],
            time: new Date().toISOString(),
            distance: runDistance,
            duration: Math.floor((Date.now() - runStartTime) / 1000),
            path: runPath,
            calories: Math.round(calculateCalories(runDistance, Math.floor((Date.now() - runStartTime) / 1000))),
            note: ''
        };
        data.runs.push(run);
        saveData(data);
        currentRunId = run.id;

        const distKm = (runDistance / 1000).toFixed(2);
        setTimeout(() => {
            showToast(`跑步完成！${distKm} 公里 🎉`, '🏃');
            if (confirm(`跑步完成！距离 ${distKm} km，继续查看详情？`)) {
                showRunDetail(run.id);
            }
        }, 300);
    }

    cleanupAmap();

    const runModal = document.getElementById('runModal');
    if (runModal) runModal.style.display = 'none';
    document.body.classList.remove('running');

    runPath = [];
    runDistance = 0;
    lastPosition = null;
    amap跑步路径 = [];

    cleanupOSM();
    updateTodayHistory();
    updateWeekStatsPreview();
}

function cleanupAmap() {
    if (amapMap) {
        try { amapMap.destroy(); } catch (e) {}
        amapMap = null;
    }
    amapPolyline = null;
    amapStartMarker = null;
    amapEndMarker = null;
    amapCurrentMarker = null;
}

function cleanupOSM() {
    if (osmMap) {
        try { osmMap.remove(); } catch (e) {}
        osmMap = null;
    }
    osmPolyline = null;
    osmStartMarker = null;
    osmCurrentMarker = null;
}

// ============ 历史记录 ============
function showHistory() {
    const loadingEl = document.getElementById('historyLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    setTimeout(() => {
        const data = getData();
        const runs = [...data.runs].sort((a, b) => new Date(b.time) - new Date(a.time));

        const monthFilter = document.getElementById('historyMonthFilter');
        if (monthFilter) {
            const months = [...new Set(runs.map(r => r.date.substring(0, 7)))].sort().reverse();
            const currentVal = monthFilter.value;
            monthFilter.innerHTML = '<option value="">全部月份</option>' +
                months.map(m => {
                    const [y, mo] = m.split('-');
                    return `<option value="${m}">${y}年${parseInt(mo)}月</option>`;
                }).join('');
            monthFilter.value = currentVal;
            monthFilter.onchange = () => filterHistory(monthFilter.value);
        }

        renderHistoryList(runs);
        if (loadingEl) loadingEl.style.display = 'none';
    }, 100);
}

function filterHistory(monthStr) {
    const data = getData();
    let runs = [...data.runs].sort((a, b) => new Date(b.time) - new Date(a.time));
    if (monthStr) runs = runs.filter(r => r.date.startsWith(monthStr));
    renderHistoryList(runs);
}

function renderHistoryList(runs) {
    const container = document.getElementById('historyList');
    if (!container) return;

    if (runs.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无历史记录<br><small style="color:#a0aec0">开始你的第一次跑步吧！</small></div>';
        return;
    }

    const groups = {};
    runs.forEach(run => {
        const month = run.date.substring(0, 7);
        if (!groups[month]) groups[month] = [];
        groups[month].push(run);
    });

    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const sortedMonths = Object.keys(groups).sort().reverse();

    container.innerHTML = sortedMonths.map(month => {
        const [y, m] = month.split('-');
        const monthTotal = groups[month].reduce((sum, r) => sum + r.distance / 1000, 0);
        const runsHtml = groups[month].map(run => {
            const d = new Date(run.time);
            const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const distKm = (run.distance / 1000).toFixed(2);
            const pace = formatPace(run.distance, run.duration);
            const durMin = Math.floor(run.duration / 60);
            const durSec = run.duration % 60;
            const durationStr = `${durMin}分${durSec}秒`;
            const calories = run.calories || Math.round(calculateCalories(run.distance, run.duration));
            const noteIcon = run.note ? '💬' : '';

            return `
                <div class="history-item" onclick="showRunDetail(${run.id})" touchable>
                    <div class="history-item-left">
                        <div class="history-date-badge">${d.getDate()}<span>日</span></div>
                    </div>
                    <div class="history-item-content">
                        <div class="history-item-header">
                            <span class="history-title">${distKm} 公里跑步 ${noteIcon}</span>
                            <span class="history-pace">⏱️ ${pace}/km</span>
                        </div>
                        <div class="history-item-stats">
                            <span>🕐 ${timeStr}</span>
                            <span>⏱️ ${durationStr}</span>
                            <span>🔥 ${calories}千卡</span>
                        </div>
                        ${run.note ? `<div class="history-note-preview">💬 ${run.note.substring(0, 30)}${run.note.length > 30 ? '...' : ''}</div>` : ''}
                    </div>
                    <div class="history-item-arrow">›</div>
                </div>
            `;
        }).join('');

        const monthLabel = `${y}年 ${monthNames[parseInt(m) - 1]}`;
        return `
            <div class="history-group">
                <div class="history-group-header">
                    <span class="history-group-title">${monthLabel}</span>
                    <span class="history-group-total">${monthTotal.toFixed(1)} km</span>
                </div>
                <div class="history-group-items">${runsHtml}</div>
            </div>
        `;
    }).join('');
}

// ============ 跑步详情 ============
function showRunDetail(runId) {
    const data = getData();
    const run = data.runs.find(r => r.id === runId);
    if (!run) return;

    currentEditingRunId = runId;

    const modal = document.getElementById('runDetailModal');
    const titleEl = document.getElementById('detailTitle');
    const statsEl = document.getElementById('detailStats');
    const noteSection = document.getElementById('noteSection');
    const noteInput = document.getElementById('runNoteInput');
    const mapLoading = document.getElementById('detailMapLoading');

    if (titleEl) {
        const d = new Date(run.time);
        titleEl.textContent = `${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} 跑步`;
    }

    if (statsEl) {
        const distKm = (run.distance / 1000).toFixed(2);
        const durMin = Math.floor(run.duration / 60);
        const durSec = run.duration % 60;
        const durFormatted = `${String(durMin).padStart(2,'0')}:${String(durSec).padStart(2,'0')}`;
        const pace = formatPace(run.distance, run.duration);
        const calories = run.calories || Math.round(calculateCalories(run.distance, run.duration));
        const avgSpeed = run.duration > 0 ? ((run.distance / 1000) / (run.duration / 3600)).toFixed(1) : '0.0';

        statsEl.innerHTML = `
            <div class="detail-stat-card primary">
                <span class="detail-stat-icon">📍</span>
                <span class="detail-stat-val">${distKm}</span>
                <span class="detail-stat-label">公里</span>
            </div>
            <div class="detail-stat-card">
                <span class="detail-stat-icon">⏱️</span>
                <span class="detail-stat-val">${durFormatted}</span>
                <span class="detail-stat-label">时长</span>
            </div>
            <div class="detail-stat-card">
                <span class="detail-stat-icon">⚡</span>
                <span class="detail-stat-val">${pace}</span>
                <span class="detail-stat-label">配速 /km</span>
            </div>
            <div class="detail-stat-card">
                <span class="detail-stat-icon">🚀</span>
                <span class="detail-stat-val">${avgSpeed}</span>
                <span class="detail-stat-label">均速 km/h</span>
            </div>
            <div class="detail-stat-card">
                <span class="detail-stat-icon">🔥</span>
                <span class="detail-stat-val">${calories}</span>
                <span class="detail-stat-label">千卡</span>
            </div>
            <div class="detail-stat-card">
                <span class="detail-stat-icon">👣</span>
                <span class="detail-stat-val">${Math.round(run.distance * 1.3)}</span>
                <span class="detail-stat-label">步数</span>
            </div>
        `;
    }

    // 显示备注
    if (noteSection) {
        if (run.note) {
            noteSection.style.display = 'block';
            if (noteInput) noteInput.value = run.note;
        } else {
            noteSection.style.display = 'none';
            if (noteInput) noteInput.value = '';
        }
    }

    if (modal) modal.style.display = 'flex';

    // 删除按钮
    const delBtn = document.getElementById('deleteRunBtn');
    if (delBtn) {
        delBtn.onclick = () => {
            if (confirm('确定删除这条跑步记录？此操作不可恢复。')) {
                deleteRun(runId);
                closeRunDetail();
                showToast('记录已删除', '🗑️');
            }
        };
    }

    // 编辑备注按钮
    const editBtn = document.getElementById('editNoteBtn');
    if (editBtn) {
        editBtn.onclick = () => {
            const noteSec = document.getElementById('noteSection');
            const noteIn = document.getElementById('runNoteInput');
            if (noteSec && noteIn) {
                noteSec.style.display = 'block';
                noteIn.focus();
            }
        };
    }

    // 保存备注
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.onclick = () => {
            const noteVal = document.getElementById('runNoteInput').value.trim();
            saveRunNote(runId, noteVal);
            const noteSec = document.getElementById('noteSection');
            if (noteSec) noteSec.style.display = noteVal ? 'block' : 'none';
            showToast('备注已保存', '💾');
        };
    }

    // 取消备注
    const cancelNoteBtn = document.getElementById('cancelNoteBtn');
    if (cancelNoteBtn) {
        cancelNoteBtn.onclick = () => {
            const noteSec = document.getElementById('noteSection');
            const data2 = getData();
            const run2 = data2.runs.find(r => r.id === runId);
            if (noteSec) noteSec.style.display = run2 && run2.note ? 'block' : 'none';
            if (noteSec && run2 && run2.note) {
                document.getElementById('runNoteInput').value = run2.note;
            }
        };
    }

    // 加载地图
    if (mapLoading) mapLoading.style.display = 'flex';
    setTimeout(() => {
        initDetailMap(run);
        if (mapLoading) mapLoading.style.display = 'none';
    }, 100);
}

function initDetailMap(run) {
    const key = getAmapKey();
    if (!key) return;
    if (typeof AMap === 'undefined') return;
    if (!run.path || run.path.length < 2) return;

    const container = document.getElementById('detailAmapContainer');
    if (!container) return;

    const lats = run.path.map(p => p.lat);
    const lngs = run.path.map(p => p.lng);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

    try {
        const detailMap = new AMap.Map('detailAmapContainer', {
            zoom: 15,
            center: [centerLng, centerLat],
            mapStyle: 'amap://styles/normal'
        });

        const pathLngLat = run.path.map(p => new AMap.LngLat(p.lng, p.lat));

        const polyline = new AMap.Polyline({
            strokeColor: '#667eea',
            strokeWeight: 6,
            strokeOpacity: 0.9
        });
        polyline.setPath(pathLngLat);
        detailMap.add(polyline);

        detailMap.add(new AMap.Marker({
            position: pathLngLat[0],
            icon: new AMap.Icon({
                size: new AMap.Size(24, 24),
                image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#48bb78"/><text x="12" y="16" text-anchor="middle" font-size="12">🚩</text></svg>')
            })
        }));

        detailMap.add(new AMap.Marker({
            position: pathLngLat[pathLngLat.length - 1],
            icon: new AMap.Icon({
                size: new AMap.Size(24, 24),
                image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#fc8181"/><text x="12" y="16" text-anchor="middle" font-size="12">🏁</text></svg>')
            })
        }));

        detailMap.setFitView();
    } catch (e) {
        console.error('详情地图初始化失败:', e);
    }
}

function closeRunDetail() {
    const modal = document.getElementById('runDetailModal');
    if (modal) modal.style.display = 'none';
    currentEditingRunId = null;
    const container = document.getElementById('detailAmapContainer');
    if (container) container.innerHTML = '';
}

function saveRunNote(runId, note) {
    const data = getData();
    const run = data.runs.find(r => r.id === runId);
    if (run) {
        run.note = note;
        saveData(data);
        // 更新历史列表中的显示
        if (document.getElementById('pageHistory').classList.contains('active')) {
            showHistory();
        }
    }
}

function deleteRun(runId) {
    const data = getData();
    data.runs = data.runs.filter(r => r.id !== runId);
    saveData(data);
    showHistory();
    updateStatsPage();
    updateWeekStatsPreview();
}

// ============ 数据导出 ============
function exportData() {
    const data = getData();
    const exportObj = {
        exportDate: new Date().toISOString(),
        version: 'exercise-tracker-v3',
        records: data.records,
        runs: data.runs,
        settings: getSettings()
    };

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().split('T')[0];
    a.download = `运动记录_${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('数据已导出', '📤');
}

// ============ 统计页面 ============
function showStats() {
    updateStatsPage();
}

function updateStatsPage() {
    const data = getData();
    const runs = data.runs;

    const totalRuns = runs.length;
    const totalDistance = runs.reduce((s, r) => s + r.distance, 0) / 1000;
    const totalDuration = runs.reduce((s, r) => s + r.duration, 0) / 60;
    const totalCalories = runs.reduce((s, r) => s + (r.calories || Math.round(calculateCalories(r.distance, r.duration))), 0);

    let avgPace = '--:--';
    if (totalDistance > 0) {
        const totalMin = totalDuration;
        const paceVal = totalMin / totalDistance;
        avgPace = `${Math.floor(paceVal)}:${String(Math.round((paceVal - Math.floor(paceVal)) * 60)).padStart(2, '0')}`;
    }

    const setIf = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setIf('totalRuns', totalRuns);
    setIf('totalDistance', totalDistance.toFixed(1));
    setIf('totalDuration', Math.round(totalDuration));
    setIf('avgPace', avgPace);
    setIf('totalCalories', totalCalories);
    setIf('totalSteps', Math.round(totalDistance * 1300).toLocaleString());

    // Show empty state if no data
    const emptyTip = document.getElementById('statsEmptyTip');
    if (emptyTip) {
        emptyTip.style.display = totalRuns === 0 ? 'block' : 'none';
    }

    drawWeekChart(runs);
    drawMonthGrid(runs);
    drawMonthTrend(runs);
    drawWeeklySummary(runs);
    drawMonthCompare(runs);
}

function drawWeeklySummary(runs) {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekRuns = runs.filter(r => {
        const rd = new Date(r.date);
        return rd >= weekStart && rd <= today;
    });

    const weekTotalDist = weekRuns.reduce((s, r) => s + r.distance / 1000, 0);
    const weekTotalTime = weekRuns.reduce((s, r) => s + r.duration, 0) / 60;
    const weekTotalCal = weekRuns.reduce((s, r) => s + (r.calories || Math.round(calculateCalories(r.distance, r.duration))), 0);
    const weekAvgPaceVal = weekTotalDist > 0 ? weekTotalTime / weekTotalDist : 0;
    const weekBestRunDist = weekRuns.reduce((max, r) => Math.max(max, r.distance / 1000), 0);

    const setIf = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setIf('weekRunsCount', weekRuns.length);
    setIf('weekTotalDist', weekTotalDist.toFixed(1));
    setIf('weekTotalTime', Math.round(weekTotalTime));
    setIf('weekTotalCal', weekTotalCal);
    setIf('weekAvgPace', weekAvgPaceVal > 0 ? `${Math.floor(weekAvgPaceVal)}:${String(Math.round((weekAvgPaceVal - Math.floor(weekAvgPaceVal)) * 60)).padStart(2, '0')}` : '--:--');
    setIf('weekBestRun', weekBestRunDist > 0 ? weekBestRunDist.toFixed(2) + ' km' : '-');
}

function drawMonthCompare(runs) {
    const today = new Date();
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    const thisMonthRuns = runs.filter(r => {
        const rd = new Date(r.date);
        return rd >= thisMonthStart && rd <= today;
    });

    const lastMonthRuns = runs.filter(r => {
        const rd = new Date(r.date);
        return rd >= lastMonthStart && rd <= lastMonthEnd;
    });

    const thisMonthDist = thisMonthRuns.reduce((s, r) => s + r.distance / 1000, 0);
    const lastMonthDist = lastMonthRuns.reduce((s, r) => s + r.distance / 1000, 0);

    const setIf = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setIf('thisMonthRuns', thisMonthRuns.length);
    setIf('lastMonthRuns', lastMonthRuns.length);
    setIf('thisMonthDist', thisMonthDist.toFixed(1));
    setIf('lastMonthDist', lastMonthDist.toFixed(1));
}

function drawWeekChart(runs) {
    const canvas = document.getElementById('weekChartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = 180 * 2;
    ctx.scale(2, 2);
    const w = rect.width;
    const h = 180;

    const today = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekData = [];
    let maxDist = 0;

    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const dayDist = runs.filter(r => r.date === dateStr)
            .reduce((s, r) => s + r.distance / 1000, 0);
        weekData.push({ day: weekDays[i], dist: dayDist, isToday: dateStr === today.toISOString().split('T')[0] });
        maxDist = Math.max(maxDist, dayDist);
    }

    const barWidth = (w - 60) / 7;
    const chartH = h - 40;
    const colors = weekData.map(d => d.isToday ? '#48bb78' : '#667eea');
    const gradientTops = ['#a3bffa', '#68d391'];

    ctx.fillStyle = '#718096';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    
    // Y-axis grid lines and labels
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = 10 + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(30, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
        ctx.fillText((maxDist * (4 - i) / 4).toFixed(1) + ' km', 28, y + 3);
    }

    // X-axis baseline
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(30, 10 + chartH);
    ctx.lineTo(w - 10, 10 + chartH);
    ctx.stroke();

    weekData.forEach((d, i) => {
        const barH = maxDist > 0 ? (d.dist / maxDist) * (chartH - 20) : 0;
        const x = 40 + i * barWidth;
        const y = 10 + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y, x, 10 + chartH);
        const isToday = weekData.findIndex(dd => dd.isToday);
        gradient.addColorStop(0, isToday === i ? '#48bb78' : '#667eea');
        gradient.addColorStop(1, isToday === i ? '#68d391' : '#a3bffa');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        const bw = barWidth - 4;
        const bh = barH;
        const rx = x + 2;
        const ry = y;
        const r = 4;
        // Rounded rect without native support
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + bw - r, ry);
        ctx.quadraticCurveTo(rx + bw, ry, rx + bw, ry + r);
        ctx.lineTo(rx + bw, ry + bh);
        ctx.lineTo(rx, ry + bh);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
        ctx.fill();

        // Value label on top
        if (d.dist > 0) {
            ctx.fillStyle = '#2d3748';
            ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.dist.toFixed(1), x + barWidth / 2, y - 4);
        }

        // Day label below
        ctx.fillStyle = d.isToday ? '#48bb78' : '#718096';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.day, x + barWidth / 2, 10 + chartH + 16);
        
        // Today indicator dot
        if (d.isToday) {
            ctx.beginPath();
            ctx.arc(x + barWidth / 2, 10 + chartH + 22, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#48bb78';
            ctx.fill();
        }
    });
}

function drawMonthGrid(runs) {
    const container = document.getElementById('monthDaysGrid');
    if (!container) return;

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const todayStr = today.toISOString().split('T')[0];

    const data = getData();
    const runDates = new Set(data.runs
        .filter(r => r.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
        .map(r => r.date));

    let html = dayNames.map(d => `<div class="month-day-header">${d}</div>`).join('');

    for (let i = 0; i < firstDay; i++) {
        html += '<div class="month-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        let cls = 'month-day';
        if (runDates.has(dateStr)) cls += ' has-run';
        if (dateStr === todayStr) cls += ' today';
        html += `<div class="${cls}">${d}</div>`;
    }

    container.innerHTML = html;
}

function drawMonthTrend(runs) {
    const canvas = document.getElementById('monthTrendCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = 160 * 2;
    ctx.scale(2, 2);
    const w = rect.width;
    const h = 160;

    const today = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const dist = runs
            .filter(r => r.date.startsWith(key))
            .reduce((s, r) => s + r.distance / 1000, 0);
        months.push({
            label: `${d.getMonth() + 1}月`,
            dist,
            isCurrent: i === 0
        });
    }

    const maxDist = Math.max(...months.map(m => m.dist), 1);
    const chartH = h - 40;
    const barW = (w - 40) / 6;

    // Grid lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#a0aec0';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
        const y = 10 + (chartH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(30, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
        ctx.fillText((maxDist * (3 - i) / 3).toFixed(1) + ' km', 28, y + 3);
    }

    // Baseline
    ctx.beginPath();
    ctx.moveTo(30, 10 + chartH);
    ctx.lineTo(w - 10, 10 + chartH);
    ctx.stroke();

    months.forEach((m, i) => {
        const barH = (m.dist / maxDist) * (chartH - 10);
        const x = 35 + i * barW;
        const y = 10 + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y, x, 10 + chartH);
        gradient.addColorStop(0, m.isCurrent ? '#48bb78' : '#667eea');
        gradient.addColorStop(1, m.isCurrent ? '#68d391' : '#a3bffa');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        const bw = barW - 8;
        const bh = barH;
        const rx = x;
        const ry = y;
        const r = 4;
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + bw - r, ry);
        ctx.quadraticCurveTo(rx + bw, ry, rx + bw, ry + r);
        ctx.lineTo(rx + bw, ry + bh);
        ctx.lineTo(rx, ry + bh);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
        ctx.fill();

        // Value on top
        if (m.dist > 0) {
            ctx.fillStyle = '#2d3748';
            ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m.dist.toFixed(1), x + (barW - 8) / 2, y - 4);
        }

        // Month label
        ctx.fillStyle = m.isCurrent ? '#48bb78' : '#718096';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(m.label, x + (barW - 8) / 2, 10 + chartH + 14);
        
        // Current month dot
        if (m.isCurrent) {
            ctx.beginPath();
            ctx.arc(x + (barW - 8) / 2, 10 + chartH + 20, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#48bb78';
            ctx.fill();
        }
    });
}

// ============ UI更新 ============
function updateStepDisplay() {
    const settings = getSettings();
    const steps = stepCount;
    const percent = Math.min(100, Math.round(steps / settings.stepTarget * 100));

    const el = id => document.getElementById(id);

    if (el('stepCount')) el('stepCount').textContent = steps.toLocaleString();
    if (el('targetProgress')) el('targetProgress').style.width = percent + '%';
    if (el('targetPercent')) el('targetPercent').textContent = percent + '%';
    if (el('stepTarget')) el('stepTarget').textContent = settings.stepTarget.toLocaleString();
    if (el('calories')) el('calories').textContent = Math.round(steps * 0.04);
    if (el('distance')) el('distance').textContent = (steps * settings.stepLength / 100 / 1000).toFixed(1);
    if (el('activeTime')) el('activeTime').textContent = Math.round(steps * 0.5 / 60);

    // 步数圆环进度
    const ringEl = document.getElementById('stepRingProgress');
    if (ringEl) {
        const circumference = 2 * Math.PI * 58; // r=58
        const offset = circumference - (percent / 100) * circumference;
        ringEl.style.strokeDasharray = `${circumference}`;
        ringEl.style.strokeDashoffset = offset;
    }
}

function updateTodayHistory() {
    const data = getData();
    const today = new Date().toISOString().split('T')[0];
    const todayRuns = data.runs.filter(r => r.date === today);

    const container = document.getElementById('todayHistory');
    if (!container) return;

    if (todayRuns.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无记录，开始你的第一次运动吧！<br><small style="color:#a0aec0">点击下方"开始跑步"按钮</small></div>';
        return;
    }

    container.innerHTML = todayRuns.map(run => {
        const d = new Date(run.time);
        const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const distKm = (run.distance / 1000).toFixed(2);
        const pace = formatPace(run.distance, run.duration);
        const noteIcon = run.note ? '💬' : '';
        return `
            <div class="history-item" onclick="showRunDetail(${run.id})" touchable>
                <span class="history-icon">🏃</span>
                <div class="history-info">
                    <div class="history-title">跑步 ${distKm} 公里 ${noteIcon}</div>
                    <div class="history-detail">${formatDuration(run.duration)} · 配速 ${pace}/km</div>
                </div>
                <span class="history-time">${timeStr}</span>
            </div>
        `;
    }).join('');
}

function updateWeekStatsPreview() {
    const data = getData();
    const today = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekData = [];
    let maxSteps = 0;

    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const dayRuns = data.runs.filter(r => r.date === dateStr);
        const dayDist = dayRuns.reduce((s, r) => s + r.distance / 1000, 0);
        const daySteps = Math.round(dayDist * 1300);
        weekData.push({
            day: weekDays[i],
            steps: daySteps,
            dist: dayDist,
            isToday: dateStr === today.toISOString().split('T')[0]
        });
        maxSteps = Math.max(maxSteps, daySteps);
    }

    const chartContainer = document.getElementById('weekChartPreview');
    if (chartContainer) {
        chartContainer.innerHTML = weekData.map(d => {
            const height = maxSteps > 0 ? Math.max(5, (d.steps / maxSteps) * 80) : 5;
            return `
                <div class="week-bar">
                    <div class="week-bar-value">${d.steps > 0 ? Math.round(d.steps / 1000) + 'k' : ''}</div>
                    <div class="week-bar-fill ${d.isToday ? 'today' : ''}" style="height:${height}px"></div>
                    <div class="week-bar-label">${d.day}</div>
                </div>
            `;
        }).join('');
    }

    const weekTotalSteps = weekData.reduce((s, d) => s + d.steps, 0);
    const weekTotalRuns = data.runs.filter(r => {
        const rd = new Date(r.date);
        return rd >= weekStart && rd <= today;
    }).length;
    const weekTotalDist = weekData.reduce((s, d) => s + d.dist, 0);

    const setIf = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setIf('weekSteps', weekTotalSteps > 0 ? (weekTotalSteps / 1000).toFixed(1) + 'k' : '0');
    setIf('weekRuns', weekTotalRuns);
    setIf('weekDistance', weekTotalDist.toFixed(1));
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
}

// ============ Calorie Calculation (MET-based) ============
function calculateCalories(distanceMeters, durationSeconds) {
    // MET values for running based on speed
    // Using simplified formula: Calories = MET * weight(kg) * time(hours)
    // Assume average weight of 70kg, MET for jogging ~7, running ~9.8
    const distanceKm = distanceMeters / 1000;
    const hours = durationSeconds / 3600;
    if (hours <= 0) return 0;
    
    // Calculate speed in km/h to determine MET
    const speedKmh = distanceKm / hours;
    let met;
    if (speedKmh < 6) met = 5.0;        // walking/jogging
    else if (speedKmh < 8) met = 7.0;   // light jogging
    else if (speedKmh < 10) met = 8.3;  // jogging
    else if (speedKmh < 12) met = 9.8;  // run
    else if (speedKmh < 14) met = 11.0; // run
    else met = 12.5;                     // fast run
    
    const weightKg = 70;
    return met * weightKg * hours;
}

function formatPace(distanceMeters, durationSeconds) {
    if (distanceMeters <= 0) return '--:--';
    const paceMinPerKm = durationSeconds / 60 / (distanceMeters / 1000);
    const mins = Math.floor(paceMinPerKm);
    const secs = Math.round((paceMinPerKm - mins) * 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ============ 设置 ============
function openSettings() {
    const settings = getSettings();
    const stepTargetEl = document.getElementById('settingStepTarget');
    const stepLengthEl = document.getElementById('settingStepLength');
    const amapKeyEl = document.getElementById('settingAmapKey');
    const autoAnnounceEl = document.getElementById('settingAutoAnnounce');
    const modal = document.getElementById('settingsModal');
    const amapRadio = document.getElementById('mapProviderAmap');
    const osmRadio = document.getElementById('mapProviderOsm');

    if (stepTargetEl) stepTargetEl.value = settings.stepTarget;
    if (stepLengthEl) stepLengthEl.value = settings.stepLength;
    if (amapKeyEl) amapKeyEl.value = settings.amapKey || '';
    if (autoAnnounceEl) autoAnnounceEl.checked = settings.autoAnnounce !== false;
    if (amapRadio) amapRadio.checked = settings.mapProvider !== 'osm';
    if (osmRadio) osmRadio.checked = settings.mapProvider === 'osm';
    if (modal) modal.style.display = 'flex';
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

function saveSettingsHandler() {
    const mapProviderEl = document.querySelector('input[name="mapProvider"]:checked');
    const newSettings = {
        stepTarget: parseInt(document.getElementById('settingStepTarget').value) || 10000,
        stepLength: parseInt(document.getElementById('settingStepLength').value) || 70,
        amapKey: (document.getElementById('settingAmapKey').value || '').trim(),
        autoAnnounce: document.getElementById('settingAutoAnnounce').checked,
        mapProvider: mapProviderEl ? mapProviderEl.value : 'amap'
    };
    saveSettings(newSettings);
    updateStepDisplay();
    closeSettings();
    showToast('设置已保存', '💾');
}

// ============ 页面导航 ============
function navigateTo(pageName) {
    const pageEl = document.getElementById('page' + pageName.charAt(0).toUpperCase() + pageName.slice(1));
    if (!pageEl) return;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    pageEl.classList.add('active');
    const navBtn = document.querySelector(`.nav-item[data-page="page${pageName.charAt(0).toUpperCase() + pageName.slice(1)}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (pageName === 'history') showHistory();
    if (pageName === 'stats') showStats();
}

// ============ PWA 自动更新 ============
let newServiceWorker = null;

function setupUpdatePrompt() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (newServiceWorker) {
                newServiceWorker.addEventListener('statechange', () => {
                    if (newServiceWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdatePrompt();
                    }
                });
            }
        });

        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'SKIP_WAITING') {
                newServiceWorker && newServiceWorker.postMessage({ type: 'SKIP_WAITING' });
            }
        });
    }
}

// 隐藏加载画面
function hideLoadingScreen() {
    const screen = document.getElementById('appLoadingScreen');
    if (screen) {
        screen.classList.add('hidden');
        // Remove from DOM after transition
        setTimeout(() => {
            if (screen.parentNode) screen.parentNode.removeChild(screen);
        }, 600);
    }
}

function showUpdatePrompt() {
    const toast = document.getElementById('updateToast');
    if (toast) {
        toast.classList.add('visible');
        document.getElementById('updateBtn').onclick = () => {
            newServiceWorker && newServiceWorker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
        };
    }
}

// ============ 初始化 ============
function init() {
    console.log('App初始化开始');

    const now = new Date();
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        // 强制使用中文格式，防止系统语言影响
        dateEl.textContent = now.toLocaleDateString('zh-CN', {
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            weekday: 'long',
            locale: 'zh-CN'
        });
        console.log('当前日期:', dateEl.textContent);
    }

    // 恢复今日步数
    const data = getData();
    const today = now.toISOString().split('T')[0];
    const todayRecord = data.records.find(r => r.date === today);
    if (todayRecord) stepCount = todayRecord.steps || 0;

    // 更新UI
    updateStepDisplay();
    updateTodayHistory();
    updateWeekStatsPreview();

    // 步数检测
    startStepDetection();

    // 桌面端模拟
    simulateSteps();

    // Service Worker + PWA更新
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                console.log('SW registered');
                reg.addEventListener('updatefound', () => {
                    newServiceWorker = reg.installing;
                    console.log('New SW found');
                });
                if (reg.waiting) {
                    newServiceWorker = reg.waiting;
                    showUpdatePrompt();
                }
                setupUpdatePrompt();
            })
            .catch(err => console.warn('SW registration failed:', err));
    }

    // 绑定按钮事件
    bindButtonEvents();

    console.log('🏃 运动记录App已初始化完成');
}

function bindButtonEvents() {
    // 开始跑步
    const startBtn = document.getElementById('startRunBtn');
    if (startBtn) startBtn.addEventListener('click', startRun);

    // 停止跑步
    const stopBtn = document.getElementById('stopRunBtn');
    if (stopBtn) stopBtn.addEventListener('click', stopRun);

    // 关闭跑步弹窗
    const closeRunBtn = document.getElementById('closeRunBtn');
    if (closeRunBtn) {
        closeRunBtn.addEventListener('click', () => {
            if (confirm('确定要退出跑步吗？')) {
                stopRun();
            }
        });
    }

    // 设置
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);

    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeSettings);

    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettingsHandler);

    // 返回详情
    const backFromDetail = document.getElementById('backFromDetail');
    if (backFromDetail) backFromDetail.addEventListener('click', closeRunDetail);

    // 底部导航
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page.replace('page', '').toLowerCase()));
    });

    // 导出数据
    const exportBtn = document.getElementById('exportDataBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportData);

    // 模态框点击背景关闭
    ['runModal', 'settingsModal', 'runDetailModal'].forEach(id => {
        const modal = document.getElementById(id);
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) {
                    if (id === 'runModal' && isRunning) return;
                    modal.style.display = 'none';
                }
            });
        }
    });

    // iOS Safari 安全区域
    if (navigator.userAgent.match(/(iPhone|iPad)/i)) {
        document.body.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    }
}

// 页面离开保存步数
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        const data = getData();
        const today = new Date().toISOString().split('T')[0];
        const todayRecord = data.records.find(r => r.date === today);
        if (todayRecord) {
            todayRecord.steps = stepCount;
        } else {
            data.records.push({ date: today, steps: stepCount });
        }
        saveData(data);
    }
});

window.addEventListener('beforeunload', () => {
    const data = getData();
    const today = new Date().toISOString().split('T')[0];
    const todayRecord = data.records.find(r => r.date === today);
    if (todayRecord) {
        todayRecord.steps = stepCount;
    } else {
        data.records.push({ date: today, steps: stepCount });
    }
    saveData(data);
});

// 启动 + 隐藏加载画面
function safeStart() {
    try {
        init();
    } catch (e) {
        console.error('Init error:', e);
    }
    // 延迟隐藏加载画面，确保首帧渲染
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            hideLoadingScreen();
            // 最终保障：如果5秒后还在转圈，强制移除
            setTimeout(() => {
                const screen = document.getElementById('appLoadingScreen');
                if (screen) {
                    screen.classList.add('hidden');
                    screen.style.display = 'none';
                }
            }, 5000);
        });
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeStart);
} else {
    safeStart();
}
