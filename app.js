/**
 * 运动记录App - 主逻辑
 * 功能：步数统计、GPS跑步追踪、数据存储
 */

// ============ 数据存储 ============
const STORAGE_KEY = 'exercise_data';
const SETTINGS_KEY = 'exercise_settings';

// 默认设置
const DEFAULT_SETTINGS = {
    stepTarget: 10000,
    runTarget: 5,
    stepLength: 70 // cm
};

// 获取数据
function getData() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : { records: [], runs: [] };
    } catch (e) {
        console.error('获取数据失败:', e);
        return { records: [], runs: [] };
    }
}

// 保存数据
function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('保存数据失败:', e);
    }
}

// 获取设置
function getSettings() {
    try {
        const settings = localStorage.getItem(SETTINGS_KEY);
        return settings ? { ...DEFAULT_SETTINGS, ...JSON.parse(settings) } : DEFAULT_SETTINGS;
    } catch (e) {
        console.error('获取设置失败:', e);
        return DEFAULT_SETTINGS;
    }
}

// 保存设置
function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.error('保存设置失败:', e);
    }
}

// ============ 步数计数 ============
let stepCount = 0;
let lastAcceleration = { x: 0, y: 0, z: 0 };
let isStepDetecting = false;
let stepDetectionThreshold = 12;

function startStepDetection() {
    if (isStepDetecting) return;
    
    if ('DeviceMotionEvent' in window) {
        // iOS 13+ 需要请求权限
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            // iOS 13+ 需要用户触发，这里用按钮点击触发
            console.log('iOS设备，需要用户授权步数检测');
        } else {
            enableStepDetection();
        }
    } else {
        console.log('设备不支持步数检测');
    }
}

function enableStepDetection() {
    isStepDetecting = true;
    window.addEventListener('devicemotion', handleDeviceMotion);
    console.log('步数检测已启动');
}

function handleDeviceMotion(event) {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;
    
    const { x, y, z } = acc;
    const delta = Math.sqrt(
        Math.pow(x - lastAcceleration.x, 2) +
        Math.pow(y - lastAcceleration.y, 2) +
        Math.pow(z - lastAcceleration.z, 2)
    );
    
    // 检测步伐（简单阈值法）
    if (delta > stepDetectionThreshold && delta < 50) {
        stepCount++;
        updateStepDisplay();
    }
    
    lastAcceleration = { x, y, z };
}

// ============ GPS跑步追踪 ============
let isRunning = false;
let runStartTime = null;
let runWatchId = null;
let runPath = [];
let runDistance = 0;
let lastPosition = null;
let runTimer = null;

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
    
    // 显示跑步弹窗
    const runModal = document.getElementById('runModal');
    if (runModal) {
        runModal.style.display = 'flex';
        document.body.classList.add('running');
    }
    
    // 开始计时
    runTimer = setInterval(updateRunTime, 1000);
    
    // 开始GPS追踪
    runWatchId = navigator.geolocation.watchPosition(
        updateRunPosition,
        handleGeoError,
        { enableHighAccuracy: true, maximumAge: 1000 }
    );
    
    console.log('跑步模式已启动');
}

function updateRunPosition(position) {
    const { latitude, longitude, speed, accuracy } = position.coords;
    const currentPos = { lat: latitude, lng: longitude, time: Date.now() };
    
    // 绘制地图占位
    const mapPlaceholder = document.getElementById('mapPlaceholder');
    if (mapPlaceholder) {
        mapPlaceholder.style.display = 'none';
    }
    
    // 计算距离
    if (lastPosition) {
        const dist = haversineDistance(lastPosition, currentPos);
        // 过滤GPS误差（大于100米/秒的认为是误差）
        if (dist < 100 && accuracy < 20) {
            runDistance += dist;
        }
    }
    
    runPath.push(currentPos);
    lastPosition = currentPos;
    
    // 更新显示
    updateRunStats();
    drawTrack();
}

function haversineDistance(pos1, pos2) {
    const R = 6371000; // 地球半径（米）
    const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
    const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function updateRunTime() {
    const elapsed = Math.floor((Date.now() - runStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const runTimeEl = document.getElementById('runTime');
    if (runTimeEl) {
        runTimeEl.textContent = 
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

function updateRunStats() {
    const distance = (runDistance / 1000).toFixed(2);
    const elapsed = (Date.now() - runStartTime) / 1000 / 60; // 分钟
    const pace = elapsed > 0 ? (elapsed / (runDistance / 1000)).toFixed(2) : '0.00';
    const speed = elapsed > 0 ? ((runDistance / 1000) / elapsed * 60).toFixed(1) : '0.0';
    
    const runDistanceEl = document.getElementById('runDistance');
    const runPaceEl = document.getElementById('runPace');
    const runSpeedEl = document.getElementById('runSpeed');
    
    if (runDistanceEl) runDistanceEl.textContent = distance;
    if (runPaceEl) runPaceEl.textContent = pace.replace('.', ':');
    if (runSpeedEl) runSpeedEl.textContent = speed;
}

function drawTrack() {
    const canvas = document.getElementById('trackCanvas');
    if (!canvas || runPath.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    // 计算边界
    const lats = runPath.map(p => p.lat);
    const lngs = runPath.map(p => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    const padding = 30;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    
    // 转换坐标到画布
    function toCanvas(pos) {
        const x = (pos.lng - minLng) / (maxLng - minLng || 1) * width + padding;
        const y = (maxLat - pos.lat) / (maxLat - minLat || 1) * height + padding;
        return { x, y };
    }
    
    // 画轨迹
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    
    runPath.forEach((pos, i) => {
        const { x, y } = toCanvas(pos);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // 画起点
    const start = toCanvas(runPath[0]);
    ctx.fillStyle = '#48bb78';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // 画终点（当前位置）
    const end = toCanvas(runPath[runPath.length - 1]);
    ctx.fillStyle = '#fc8181';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 8, 0, Math.PI * 2);
    ctx.fill();
}

function handleGeoError(error) {
    console.warn('GPS错误:', error.message);
}

function stopRun() {
    console.log('停止跑步被调用');
    if (!isRunning) return;
    
    isRunning = false;
    if (runTimer) clearInterval(runTimer);
    if (runWatchId) navigator.geolocation.clearWatch(runWatchId);
    
    // 保存跑步记录
    if (runDistance > 10) { // 只保存超过10米的跑步
        const data = getData();
        const run = {
            type: 'run',
            date: new Date().toISOString().split('T')[0],
            time: new Date().toISOString(),
            distance: runDistance,
            duration: Math.floor((Date.now() - runStartTime) / 1000),
            path: runPath.length > 50 ? runPath.slice(-50) : runPath // 限制路径点数量
        };
        data.runs.push(run);
        saveData(data);
    }
    
    // 关闭弹窗
    const runModal = document.getElementById('runModal');
    if (runModal) {
        runModal.style.display = 'none';
    }
    document.body.classList.remove('running');
    
    // 重置显示
    runPath = [];
    runDistance = 0;
    lastPosition = null;
    
    // 刷新页面
    updateTodayHistory();
    updateWeekStats();
}

// ============ UI更新 ============
function updateStepDisplay() {
    const settings = getSettings();
    const steps = stepCount;
    const percent = Math.min(100, Math.round(steps / settings.stepTarget * 100));
    
    const stepCountEl = document.getElementById('stepCount');
    const targetProgressEl = document.getElementById('targetProgress');
    const targetPercentEl = document.getElementById('targetPercent');
    const stepTargetEl = document.getElementById('stepTarget');
    const caloriesEl = document.getElementById('calories');
    const distanceEl = document.getElementById('distance');
    const activeTimeEl = document.getElementById('activeTime');
    
    if (stepCountEl) stepCountEl.textContent = steps.toLocaleString();
    if (targetProgressEl) targetProgressEl.style.width = percent + '%';
    if (targetPercentEl) targetPercentEl.textContent = percent + '%';
    if (stepTargetEl) stepTargetEl.textContent = settings.stepTarget.toLocaleString();
    if (caloriesEl) caloriesEl.textContent = Math.round(steps * 0.04);
    if (distanceEl) distanceEl.textContent = (steps * settings.stepLength / 100 / 1000).toFixed(1);
    if (activeTimeEl) activeTimeEl.textContent = Math.round(steps * 0.5 / 60);
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
    
    container.innerHTML = todayRuns.map(run => `
        <div class="history-item">
            <span class="history-icon">🏃</span>
            <div class="history-info">
                <div class="history-title">跑步 ${(run.distance / 1000).toFixed(2)} 公里</div>
                <div class="history-detail">${formatDuration(run.duration)} · ${calculatePace(run.distance, run.duration)}/km</div>
            </div>
            <span class="history-time">${new Date(run.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    `).join('');
}

function updateWeekStats() {
    const data = getData();
    const today = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    // 计算本周数据
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    
    const weekData = [];
    let maxSteps = 0;
    
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        
        // 该天的跑步总距离（转换为步数估算）
        const dayRuns = data.runs.filter(r => r.date === dateStr);
        const runSteps = dayRuns.reduce((sum, r) => sum + Math.round(r.distance / 0.7), 0);
        
        weekData.push({
            day: weekDays[i],
            date: dateStr,
            steps: runSteps,
            isToday: dateStr === today.toISOString().split('T')[0]
        });
        
        maxSteps = Math.max(maxSteps, runSteps);
    }
    
    // 渲染柱状图
    const chartContainer = document.getElementById('weekChart');
    if (chartContainer) {
        chartContainer.innerHTML = weekData.map(d => {
            const height = maxSteps > 0 ? Math.max(5, (d.steps / maxSteps) * 80) : 5;
            const isToday = d.isToday ? 'background: linear-gradient(180deg, #48bb78 0%, #68d391 100%);' : '';
            return `
                <div class="week-bar">
                    <div class="week-bar-value">${d.steps > 0 ? Math.round(d.steps / 1000) + 'k' : ''}</div>
                    <div class="week-bar-fill" style="height: ${height}px; ${isToday}"></div>
                    <div class="week-bar-label">${d.day}</div>
                </div>
            `;
        }).join('');
    }
    
    // 周统计
    const weekTotalSteps = weekData.reduce((sum, d) => sum + d.steps, 0);
    const weekTotalRuns = data.runs.filter(r => {
        const runDate = new Date(r.date);
        return runDate >= weekStart && runDate <= today;
    }).length;
    
    const weekStepsEl = document.getElementById('weekSteps');
    const weekRunsEl = document.getElementById('weekRuns');
    if (weekStepsEl) weekStepsEl.textContent = (weekTotalSteps / 1000).toFixed(1) + 'k';
    if (weekRunsEl) weekRunsEl.textContent = weekTotalRuns;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
}

function calculatePace(distanceMeters, durationSeconds) {
    if (distanceMeters <= 0) return '--:--';
    const paceMinPerKm = durationSeconds / 60 / (distanceMeters / 1000);
    const mins = Math.floor(paceMinPerKm);
    const secs = Math.round((paceMinPerKm - mins) * 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ============ 设置 ============
function openSettings() {
    console.log('打开设置被调用');
    const settings = getSettings();
    const stepTargetEl = document.getElementById('settingStepTarget');
    const runTargetEl = document.getElementById('settingRunTarget');
    const stepLengthEl = document.getElementById('settingStepLength');
    const settingsModal = document.getElementById('settingsModal');
    
    if (stepTargetEl) stepTargetEl.value = settings.stepTarget;
    if (runTargetEl) runTargetEl.value = settings.runTarget;
    if (stepLengthEl) stepLengthEl.value = settings.stepLength;
    if (settingsModal) settingsModal.style.display = 'flex';
}

function closeSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.style.display = 'none';
}

function saveSettings() {
    const settings = {
        stepTarget: parseInt(document.getElementById('settingStepTarget').value) || 10000,
        runTarget: parseFloat(document.getElementById('settingRunTarget').value) || 5,
        stepLength: parseInt(document.getElementById('settingStepLength').value) || 70
    };
    saveSettings(settings);
    updateStepDisplay();
    closeSettings();
}

// ============ Tab导航 ============
function showTab(tab) {
    // 移除所有active
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    
    // 显示对应内容（目前是单页，后续可扩展）
    if (tab !== 'today') {
        alert('历史和统计功能正在开发中...');
    }
}

// ============ 初始化 ============
function init() {
    console.log('App初始化开始');
    
    // 设置日期
    const now = new Date();
    const currentDateEl = document.getElementById('currentDate');
    if (currentDateEl) {
        currentDateEl.textContent = 
            now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    }
    
    // 从本地存储恢复今日步数（模拟）
    const data = getData();
    const today = now.toISOString().split('T')[0];
    const todayRecord = data.records.find(r => r.date === today);
    if (todayRecord) {
        stepCount = todayRecord.steps || 0;
    }
    
    // 更新UI
    updateStepDisplay();
    updateTodayHistory();
    updateWeekStats();
    
    // 开始步数检测
    startStepDetection();
    
    // 注册Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered successfully'))
            .catch(err => console.warn('SW registration failed:', err));
    }
    
    // 模拟步数（桌面端测试用）
    simulateSteps();
    
    // 绑定按钮事件（iOS Safari 需要用户交互触发）
    bindButtonEvents();
    
    console.log('🏃 运动记录App已初始化完成');
}

// 桌面端模拟步数（用于测试）
function simulateSteps() {
    // 在移动设备上不运行模拟
    if ('ontouchstart' in window) {
        console.log('移动设备，不运行步数模拟');
        return;
    }
    
    console.log('桌面设备，运行步数模拟');
    // 每3秒随机增加步数（模拟走路）
    setInterval(() => {
        if (!isRunning) {
            stepCount += Math.floor(Math.random() * 5) + 1;
            updateStepDisplay();
        }
    }, 3000);
}

// 页面离开时保存数据
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

// 绑定按钮事件
function bindButtonEvents() {
    console.log('绑定按钮事件');
    
    // 开始跑步按钮
    const startRunBtn = document.getElementById('startRunBtn');
    if (startRunBtn) {
        startRunBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('点击开始跑步');
            startRun();
        });
        console.log('开始跑步按钮已绑定');
    }
    
    // 设置按钮
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('点击设置');
            openSettings();
        });
        console.log('设置按钮已绑定');
    }
    
    // 底部导航
    const navToday = document.getElementById('navToday');
    const navHistory = document.getElementById('navHistory');
    const navStats = document.getElementById('navStats');
    
    if (navToday) {
        navToday.addEventListener('click', function() { showTab('today'); });
    }
    if (navHistory) {
        navHistory.addEventListener('click', function() { showTab('history'); });
    }
    if (navStats) {
        navStats.addEventListener('click', function() { showTab('stats'); });
    }
}

// 启动 - 等待DOM加载完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
