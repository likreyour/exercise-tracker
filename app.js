/**
 * 运动记录App - 主逻辑
 * 功能：步数统计、GPS跑步追踪（高德地图）、历史记录、统计数据、PWA自动更新
 */

// ============ 配置 ============
const STORAGE_KEY = 'exercise_data_v2';
const SETTINGS_KEY = 'exercise_settings_v2';
const AMAP_KEY_STORAGE = 'amap_api_key';

const DEFAULT_SETTINGS = {
    stepTarget: 10000,
    stepLength: 70, // cm
    amapKey: ''
};

// ============ 状态 ============
let stepCount = 0;
let lastAcceleration = { x: 0, y: 0, z: 0 };
let isStepDetecting = false;
let stepDetectionThreshold = 12;
let simulatedSteps = 0;

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
let amap跑步路径 = []; // AMap.LngLat array

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

function getAmapKey() {
    const settings = getSettings();
    return settings.amapKey || localStorage.getItem(AMAP_KEY_STORAGE) || '';
}

// ============ 步数检测 ============
function startStepDetection() {
    if (isStepDetecting) return;

    if ('DeviceMotionEvent' in window) {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            // iOS 13+: 需要用户授权
            console.log('iOS设备，请点击按钮授权步数检测');
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
        }
    } catch (e) {
        console.warn('步数授权失败:', e);
    }
}

function enableStepDetection() {
    isStepDetecting = true;
    window.addEventListener('devicemotion', handleDeviceMotion);
    console.log('步数检测已启动');
}

function handleDeviceMotion(event) {
    if (isRunning) return; // 跑步时不计步
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const { x, y, z } = acc;
    const delta = Math.sqrt(
        Math.pow(x - lastAcceleration.x, 2) +
        Math.pow(y - lastAcceleration.y, 2) +
        Math.pow(z - lastAcceleration.z, 2)
    );

    if (delta > stepDetectionThreshold && delta < 50) {
        stepCount++;
        updateStepDisplay();
    }

    lastAcceleration = { x, y, z };
}

// 桌面端模拟步数
function simulateSteps() {
    if ('ontouchstart' in window) {
        console.log('移动设备，不运行步数模拟');
        return;
    }
    console.log('桌面设备，运行步数模拟（每4秒增加随机步数）');
    setInterval(() => {
        if (!isRunning) {
            const add = Math.floor(Math.random() * 8) + 2;
            stepCount += add;
            simulatedSteps += add;
            updateStepDisplay();
        }
    }, 4000);
}

// ============ GPS跑步 ============
async function startRun() {
    console.log('开始跑步被调用');

    if (!navigator.geolocation) {
        alert('您的设备不支持GPS定位');
        return;
    }

    isRunning = true;
    runStartTime = Date.now();
    runPath = [];
    runDistance = 0;
    lastPosition = null;
    amap跑步路径 = [];

    // 显示跑步弹窗
    const runModal = document.getElementById('runModal');
    if (runModal) {
        runModal.style.display = 'flex';
        document.body.classList.add('running');
    }

    // 初始化高德地图
    initAmapMap();

    // 开始计时
    runTimer = setInterval(updateRunTime, 1000);

    // 开始GPS追踪
    runWatchId = navigator.geolocation.watchPosition(
        updateRunPosition,
        handleGeoError,
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    console.log('跑步模式已启动');
}

function initAmapMap() {
    const key = getAmapKey();
    if (!key || key === 'YOUR_AMAP_API_KEY_HERE') {
        const status = document.getElementById('gpsStatus');
        if (status) status.textContent = '⚠️ 请先在设置中配置高德地图 API Key';
        return;
    }

    // 检查 AMap 是否已加载
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

        // 添加控件
        amapMap.addControl(new AMap.Scale());
        amapMap.addControl(new AMap.ToolBar({ position: 'RB' }));

        // 初始化轨迹线
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

function updateRunPosition(position) {
    const { latitude, longitude, speed, accuracy } = position.coords;
    const currentPos = { lat: latitude, lng: longitude, time: Date.now() };

    const status = document.getElementById('gpsStatus');
    if (status) {
        status.textContent = '📍 GPS已定位';
        status.classList.add('active');
    }

    // 计算距离
    if (lastPosition) {
        const dist = haversineDistance(lastPosition, currentPos);
        // 过滤GPS误差
        if (dist < 100 && accuracy < 30) {
            runDistance += dist;
        }
    }

    runPath.push(currentPos);
    lastPosition = currentPos;

    // 更新高德地图
    if (amapMap) {
        const lngLat = new AMap.LngLat(longitude, latitude);
        amap跑步路径.push(lngLat);

        amapPolyline.setPath(amap跑步路径);

        // 起点标记
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

        // 当前位置标记
        if (amapCurrentMarker) {
            amapMap.remove(amapCurrentMarker);
        }
        amapCurrentMarker = new AMap.Marker({
            position: lngLat,
            icon: new AMap.Icon({
                size: new AMap.Size(20, 20),
                image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#fc8181"/><text x="10" y="14" text-anchor="middle" font-size="10">🏃</text></svg>')
            })
        });
        amapMap.add(amapCurrentMarker);

        // 移动地图中心
        amapMap.setCenter(lngLat);
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
    const elapsed = Math.floor((Date.now() - runStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const el = document.getElementById('runTime');
    if (el) el.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
    }
}

function stopRun() {
    console.log('停止跑步被调用');
    if (!isRunning) return;

    isRunning = false;
    if (runTimer) { clearInterval(runTimer); runTimer = null; }
    if (runWatchId) { navigator.geolocation.clearWatch(runWatchId); runWatchId = null; }

    // 保存跑步记录
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
            calories: Math.round(runDistance * 0.6)
        };
        data.runs.push(run);
        saveData(data);

        // 询问是否查看详情
        setTimeout(() => {
            if (confirm(`跑步完成！距离 ${(runDistance / 1000).toFixed(2)} km，继续查看详情？`)) {
                showRunDetail(run.id);
            }
        }, 300);
    }

    // 清理地图
    cleanupAmap();

    // 关闭弹窗
    const runModal = document.getElementById('runModal');
    if (runModal) runModal.style.display = 'none';
    document.body.classList.remove('running');

    // 重置
    runPath = [];
    runDistance = 0;
    lastPosition = null;
    amap跑步路径 = [];

    // 刷新UI
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

// ============ 历史记录 ============
function showHistory() {
    const data = getData();
    const runs = [...data.runs].sort((a, b) => new Date(b.time) - new Date(a.time));

    // 填充月份筛选器
    const monthFilter = document.getElementById('historyMonthFilter');
    if (monthFilter) {
        const months = [...new Set(runs.map(r => r.date.substring(0, 7)))].sort().reverse();
        monthFilter.innerHTML = '<option value="">全部月份</option>' +
            months.map(m => `<option value="${m}">${m}</option>`).join('');
        monthFilter.onchange = () => filterHistory(monthFilter.value);
    }

    renderHistoryList(runs);
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
        container.innerHTML = '<p class="empty-state">暂无历史记录</p>';
        return;
    }

    // 按月份分组
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
        const runsHtml = groups[month].map(run => {
            const d = new Date(run.time);
            const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const distKm = (run.distance / 1000).toFixed(2);
            const pace = formatPace(run.distance, run.duration);
            return `
                <div class="history-item" onclick="showRunDetail(${run.id})">
                    <span class="history-icon">🏃</span>
                    <div class="history-info">
                        <div class="history-title">${distKm} 公里跑步</div>
                        <div class="history-detail">${formatDuration(run.duration)} · 配速 ${pace}/km</div>
                    </div>
                    <div>
                        <div class="history-distance">${distKm}</div>
                        <div class="history-time">${dateStr} ${timeStr}</div>
                    </div>
                </div>
            `;
        }).join('');

        const monthLabel = `${y}年 ${monthNames[parseInt(m) - 1]}`;
        return `<div class="history-group"><div class="history-group-title">${monthLabel}</div>${runsHtml}</div>`;
    }).join('');
}

// ============ 跑步详情 ============
function showRunDetail(runId) {
    const data = getData();
    const run = data.runs.find(r => r.id === runId);
    if (!run) return;

    const modal = document.getElementById('runDetailModal');
    const titleEl = document.getElementById('detailTitle');
    const statsEl = document.getElementById('detailStats');

    if (titleEl) {
        const d = new Date(run.time);
        titleEl.textContent = `${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} 跑步`;
    }

    if (statsEl) {
        const distKm = (run.distance / 1000).toFixed(2);
        const durMin = Math.floor(run.duration / 60);
        const durSec = run.duration % 60;
        const pace = formatPace(run.distance, run.duration);
        statsEl.innerHTML = `
            <div class="detail-stat-item">
                <span class="val">${distKm}</span>
                <span class="label">公里</span>
            </div>
            <div class="detail-stat-item">
                <span class="val">${durMin}:${String(durSec).padStart(2,'0')}</span>
                <span class="label">时长</span>
            </div>
            <div class="detail-stat-item">
                <span class="val">${pace}</span>
                <span class="label">配速 /km</span>
            </div>
            <div class="detail-stat-item">
                <span class="val">${run.calories || Math.round(run.distance * 0.6)}</span>
                <span class="label">千卡</span>
            </div>
        `;
    }

    if (modal) modal.style.display = 'flex';

    // 删除按钮
    const delBtn = document.getElementById('deleteRunBtn');
    if (delBtn) {
        delBtn.onclick = () => {
            if (confirm('确定删除这条跑步记录？')) {
                deleteRun(runId);
                closeRunDetail();
            }
        };
    }

    // 延迟初始化地图
    setTimeout(() => initDetailMap(run), 100);
}

function initDetailMap(run) {
    const key = getAmapKey();
    if (!key || key === 'YOUR_AMAP_API_KEY_HERE') return;
    if (typeof AMap === 'undefined') return;
    if (!run.path || run.path.length < 2) return;

    const container = document.getElementById('detailAmapContainer');
    if (!container) return;

    // 计算中心点
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

        // 轨迹线
        const polyline = new AMap.Polyline({
            strokeColor: '#667eea',
            strokeWeight: 6,
            strokeOpacity: 0.9
        });
        polyline.setPath(pathLngLat);
        detailMap.add(polyline);

        // 起点
        detailMap.add(new AMap.Marker({
            position: pathLngLat[0],
            icon: new AMap.Icon({
                size: new AMap.Size(24, 24),
                image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#48bb78"/><text x="12" y="16" text-anchor="middle" font-size="12">🚩</text></svg>')
            })
        }));

        // 终点
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
    // 清理详情地图
    const container = document.getElementById('detailAmapContainer');
    if (container) container.innerHTML = '';
}

function deleteRun(runId) {
    const data = getData();
    data.runs = data.runs.filter(r => r.id !== runId);
    saveData(data);
    showHistory();
    updateStatsPage();
    updateWeekStatsPreview();
}

// ============ 统计页面 ============
function showStats() {
    updateStatsPage();
}

function updateStatsPage() {
    const data = getData();
    const runs = data.runs;

    // 总览数据
    const totalRuns = runs.length;
    const totalDistance = runs.reduce((s, r) => s + r.distance, 0) / 1000;
    const totalDuration = runs.reduce((s, r) => s + r.duration, 0) / 60;
    const totalCalories = runs.reduce((s, r) => s + (r.calories || Math.round(r.distance * 0.6)), 0);

    // 平均配速
    let avgPace = '--:--';
    if (totalDistance > 0) {
        const totalMin = totalDuration;
        const paceVal = totalMin / totalDistance;
        avgPace = `${Math.floor(paceVal)}:${String(Math.round((paceVal - Math.floor(paceVal)) * 60)).padStart(2, '0')}`;
    }

    document.getElementById('totalRuns').textContent = totalRuns;
    document.getElementById('totalDistance').textContent = totalDistance.toFixed(1);
    document.getElementById('totalDuration').textContent = Math.round(totalDuration);
    document.getElementById('avgPace').textContent = avgPace;
    document.getElementById('totalCalories').textContent = totalCalories;
    document.getElementById('totalSteps').textContent = Math.round(totalDistance * 1300).toLocaleString();

    // 周柱状图
    drawWeekChart(runs);

    // 月度日历
    drawMonthGrid(runs);

    // 月度趋势
    drawMonthTrend(runs);
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

    // Y轴
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = 10 + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(30, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
        ctx.fillStyle = '#a0aec0';
        ctx.font = '10px -apple-system';
        ctx.fillText((maxDist * (4 - i) / 4).toFixed(1), 0, y + 3);
    }

    // 柱状图
    weekData.forEach((d, i) => {
        const barH = maxDist > 0 ? (d.dist / maxDist) * (chartH - 20) : 0;
        const x = 40 + i * barWidth;
        const y = 10 + chartH - barH;

        // 渐变
        const gradient = ctx.createLinearGradient(x, y, x, 10 + chartH);
        gradient.addColorStop(0, colors[i]);
        gradient.addColorStop(1, i === weekData.findIndex(dd => dd.isToday) ? '#68d391' : '#a3bffa');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x + 2, y, barWidth - 4, barH, 4);
        ctx.fill();

        // 数值
        if (d.dist > 0) {
            ctx.fillStyle = '#2d3748';
            ctx.font = 'bold 10px -apple-system';
            ctx.textAlign = 'center';
            ctx.fillText(d.dist.toFixed(1), x + barWidth / 2, y - 4);
        }

        // 标签
        ctx.fillStyle = d.isToday ? '#48bb78' : '#718096';
        ctx.font = '11px -apple-system';
        ctx.textAlign = 'center';
        ctx.fillText(d.day, x + barWidth / 2, 10 + chartH + 16);
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

    // 收集本月有跑步的日期
    const data = getData();
    const runDates = new Set(data.runs
        .filter(r => r.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
        .map(r => r.date));

    let html = dayNames.map(d => `<div class="month-day-header">${d}</div>`).join('');

    // 空白格子
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="month-day empty"></div>';
    }

    // 日期格子
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

    // 最近6个月数据
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
            dist
        });
    }

    const maxDist = Math.max(...months.map(m => m.dist), 1);
    const chartH = h - 40;
    const barW = (w - 40) / 6;

    // Y轴线
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
        const y = 10 + (chartH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(30, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
    }

    // 柱状图
    months.forEach((m, i) => {
        const barH = (m.dist / maxDist) * (chartH - 10);
        const x = 35 + i * barW;
        const y = 10 + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y, x, 10 + chartH);
        gradient.addColorStop(0, '#48bb78');
        gradient.addColorStop(1, '#68d391');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barW - 8, barH, 4);
        ctx.fill();

        if (m.dist > 0) {
            ctx.fillStyle = '#2d3748';
            ctx.font = 'bold 10px -apple-system';
            ctx.textAlign = 'center';
            ctx.fillText(m.dist.toFixed(1), x + (barW - 8) / 2, y - 4);
        }

        ctx.fillStyle = '#718096';
        ctx.font = '11px -apple-system';
        ctx.textAlign = 'center';
        ctx.fillText(m.label, x + (barW - 8) / 2, 10 + chartH + 14);
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
}

function updateTodayHistory() {
    const data = getData();
    const today = new Date().toISOString().split('T')[0];
    const todayRuns = data.runs.filter(r => r.date === today);

    const container = document.getElementById('todayHistory');
    if (!container) return;

    if (todayRuns.length === 0) {
        container.innerHTML = '<p class="empty-state">暂无记录，开始你的第一次运动吧！</p>';
        return;
    }

    container.innerHTML = todayRuns.map(run => {
        const d = new Date(run.time);
        const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const distKm = (run.distance / 1000).toFixed(2);
        const pace = formatPace(run.distance, run.duration);
        return `
            <div class="history-item" onclick="showRunDetail(${run.id})">
                <span class="history-icon">🏃</span>
                <div class="history-info">
                    <div class="history-title">跑步 ${distKm} 公里</div>
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

    if (document.getElementById('weekSteps')) document.getElementById('weekSteps').textContent = (weekTotalSteps / 1000).toFixed(1) + 'k';
    if (document.getElementById('weekRuns')) document.getElementById('weekRuns').textContent = weekTotalRuns;
    if (document.getElementById('weekDistance')) document.getElementById('weekDistance').textContent = weekTotalDist.toFixed(1);
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
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
    const modal = document.getElementById('settingsModal');

    if (stepTargetEl) stepTargetEl.value = settings.stepTarget;
    if (stepLengthEl) stepLengthEl.value = settings.stepLength;
    if (amapKeyEl) amapKeyEl.value = settings.amapKey || '';
    if (modal) modal.style.display = 'flex';
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

function saveSettings() {
    const newSettings = {
        stepTarget: parseInt(document.getElementById('settingStepTarget').value) || 10000,
        stepLength: parseInt(document.getElementById('settingStepLength').value) || 70,
        amapKey: (document.getElementById('settingAmapKey').value || '').trim()
    };
    saveSettings(newSettings);
    updateStepDisplay();
    closeSettings();
    alert('设置已保存！刷新页面后高德地图将使用新配置。');
}

// ============ 页面导航 ============
function navigateTo(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const page = document.getElementById('page' + pageName.charAt(0).toUpperCase() + pageName.slice(1));
    if (page) {
        page.classList.add('active');
        const navBtn = document.querySelector(`.nav-item[data-page="page${pageName.charAt(0).toUpperCase() + pageName.slice(1)}"]`);
        if (navBtn) navBtn.classList.add('active');
    }

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
                newServiceWorker.postMessage({ type: 'SKIP_WAITING' });
            }
        });
    }
}

function showUpdatePrompt() {
    const toast = document.getElementById('updateToast');
    if (toast) {
        toast.style.display = 'flex';
        document.getElementById('updateBtn').onclick = () => {
            newServiceWorker && newServiceWorker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
        };
    }
}

// ============ 初始化 ============
function init() {
    console.log('App初始化开始');

    // 设置日期
    const now = new Date();
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
        });
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
                console.log('SW registered, version:', reg.active ? 'active' : 'waiting');
                reg.addEventListener('updatefound', () => {
                    newServiceWorker = reg.installing;
                    console.log('New SW found, waiting...');
                });
                if (reg.waiting) {
                    newServiceWorker = reg.waiting;
                    showUpdatePrompt();
                }
                setupUpdatePrompt();
            })
            .catch(err => console.warn('SW registration failed:', err));
    }

    // 绑定按钮
    bindButtonEvents();

    console.log('🏃 运动记录App已初始化完成');
}

function bindButtonEvents() {
    // 开始跑步
    const startBtn = document.getElementById('startRunBtn');
    if (startBtn) startBtn.addEventListener('click', startRun);

    // 设置
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    // 底部导航
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page.replace('page', '').toLowerCase()));
    });

    // 模态框点击背景关闭
    ['runModal', 'settingsModal', 'runDetailModal'].forEach(id => {
        const modal = document.getElementById(id);
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) {
                    if (id === 'runModal' && isRunning) return; // 跑步中不关闭
                    modal.style.display = 'none';
                }
            });
        }
    });
}

// 页面离开保存步数
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

// 启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
