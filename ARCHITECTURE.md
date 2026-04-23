# 运动记录App - 用户系统与数据架构设计文档

> 版本: v4.0 | 日期: 2026-04-21 | 状态: 设计中

---

## 1. 设计目标

- **游客模式**：无需登录即可使用所有核心功能（步数统计、GPS跑步、数据记录）
- **账号可选**：登录提供云端同步、多设备同步能力
- **数据优先**：本地存储永远是正确数据，云端同步作为增强
- **平滑升级**：游客使用时积累的数据，登录后可无缝同步

---

## 2. 用户系统架构

### 2.1 登录方式

| 登录方式 | 描述 | 技术实现 | 游客可用 |
|---------|------|---------|---------|
| 手机号+验证码 | 快捷注册/登录 | 短信验证码API | ✅ |
| 邮箱+密码 | 传统账号体系 | 邮箱+密码Hash | ✅ |
| 微信登录 | 社交账号 | 微信OpenAPI | ✅ |
| Apple ID | iOS生态 | Sign in with Apple | ✅（iOS优先）|
| 游客模式 | 无需注册 | 设备ID生成匿名账号 | ✅（默认）|

### 2.2 游客模式设计

- 首次打开App时，自动生成一个游客账号
- 游客账号使用设备ID（UUID）作为唯一标识
- 游客数据存储在本地 IndexedDB
- 游客可以通过手机号/邮箱登录来"升级"账号，升级后数据自动合并
- 升级时：优先保留本地数据（运动记录），用户信息以登录信息为准

### 2.3 游客升级流程

```
游客使用App → 选择登录方式 → 验证身份 →
账号绑定 → 本地数据合并 → 正式账号
```

---

## 3. 数据模型

### 3.1 用户档案 (UserProfile)

```typescript
interface UserProfile {
  userId: string;           // 唯一标识（UUID或平台ID）
  provider: 'phone' | 'email' | 'wechat' | 'apple' | 'guest';
  phone?: string;           // 手机号
  email?: string;           // 邮箱
  nickname?: string;        // 昵称
  avatar?: string;          // 头像URL（Base64或URL）
  
  // 身体数据
  profile: {
    height: number;         // 身高 cm
    weight: number;         // 体重 kg
    age: number;            // 年龄
    gender: 'male' | 'female' | 'other';
    targetSteps: number;    // 步数目标
    targetCalories: number; // 卡路里目标
  };
  
  // 账号状态
  isGuest: boolean;         // 是否游客
  createdAt: number;        // 创建时间戳
  updatedAt: number;        // 更新时间戳
  lastLoginAt: number;     // 最后登录时间
}
```

### 3.2 运动记录 (ExerciseRecord)

```typescript
interface ExerciseRecord {
  id: string;               // 唯一标识
  userId: string;           // 所属用户ID
  
  // 基础信息
  type: 'running' | 'walking' | 'cycling';
  date: string;            // 日期 YYYY-MM-DD
  time: string;            // ISO时间戳
  
  // 时空数据
  startTime: number;       // 开始时间戳
  endTime: number;         // 结束时间戳
  duration: number;        // 持续时间（秒）
  
  // 运动数据
  distance: number;        // 距离（米）
  avgPace: number;         // 平均配速（分钟/公里）
  calories: number;        // 消耗卡路里（千卡）
  steps: number;           // 步数
  stepFrequency: number;   // 平均步频（步/分钟）
  
  // GPS轨迹
  gpsPath: GPSPoint[];     // GPS路径点
  
  // 环境信息
  weather?: string;        // 天气描述
  location?: string;       // 位置描述
  
  // 备注
  notes?: string;          // 用户备注
  
  // 同步状态
  syncStatus: 'pending' | 'synced' | 'conflict';
  localUpdatedAt: number;  // 本地更新时间
  cloudUpdatedAt?: number; // 云端更新时间
  version: number;         // 版本号（用于冲突检测）
}

interface GPSPoint {
  lat: number;             // 纬度
  lng: number;             // 经度
  time: number;            // 时间戳
  speed?: number;          // 速度 m/s
  altitude?: number;       // 海拔 m
}
```

### 3.3 步数日记录 (DailyStepRecord)

```typescript
interface DailyStepRecord {
  date: string;            // 日期 YYYY-MM-DD
  steps: number;           // 步数
  goal: number;            // 当日目标
  records: StepSegment[];  // 分段记录
}

interface StepSegment {
  startTime: number;
  endTime: number;
  steps: number;
}
```

---

## 4. 本地存储架构 (IndexedDB)

### 4.1 数据库设计

```
ExerciseTrackerDB (v1)
├── users              # 用户档案
│   └── { userId, ...profile }
├── exercises          # 运动记录
│   └── { id, userId, ...record }
├── daily_steps        # 每日步数
│   └── { date, userId, steps }
├── sync_queue         # 同步队列
│   └── { id, action, recordId, data, attempts, lastAttempt }
└── settings           # 应用设置
    └── { key, value }
```

### 4.2 IndexedDB 操作封装

```javascript
class LocalDB {
  constructor() {
    this.dbName = 'ExerciseTrackerDB';
    this.version = 1;
    this.db = null;
  }
  
  async init() { /* 初始化数据库 */ }
  async saveUser(user) { /* 保存用户 */ }
  async getUser(userId) { /* 获取用户 */ }
  async saveExercise(record) { /* 保存运动记录 */ }
  async getExercises(userId, options) { /* 查询运动记录 */ }
  async getExerciseById(id) { /* 获取单条记录 */ }
  async deleteExercise(id) { /* 删除记录 */ }
  async saveDailySteps(date, steps) { /* 保存步数 */ }
  async addToSyncQueue(action, recordId, data) { /* 添加同步队列 */ }
  async getSyncQueue() { /* 获取同步队列 */ }
  async removeSyncQueueItem(id) { /* 移除同步项 */ }
}
```

---

## 5. 数据同步策略

### 5.1 同步原则

1. **本地优先**：所有操作先写入本地数据库
2. **最终一致**：通过网络同步达到最终一致性
3. **乐观更新**：假设同步会成功，先更新UI
4. **冲突检测**：基于时间戳和版本号检测冲突

### 5.2 同步流程

```
用户操作 → 本地保存 → 加入同步队列 → 后台同步 → 更新同步状态
              ↓
         离线时：队列保留，重试
         在线时：立即同步
```

### 5.3 冲突解决策略

**默认策略：以本地为准 + 用户确认**

```javascript
// 冲突解决规则
function resolveConflict(local, cloud) {
  // 规则1：运动记录以时间最新为准
  if (local.type === 'exercise') {
    return local.endTime > cloud.endTime ? local : cloud;
  }
  
  // 规则2：用户档案以用户最后一次修改为准
  if (local.updatedAt > cloud.updatedAt) {
    return local;
  }
  
  // 规则3：步数记录不冲突，累加
  return { ...cloud, ...local }; // 合并
}
```

### 5.4 同步状态指示器

```javascript
// 同步状态定义
const SYNC_STATUS = {
  SYNCED: 'synced',           // 已同步
  PENDING: 'pending',         // 待同步
  SYNCING: 'syncing',         // 同步中
  ERROR: 'error',             // 同步失败
  OFFLINE: 'offline'          // 离线
};
```

在UI中显示：
- 🟢 已同步
- 🟡 同步中...
- 🔴 同步失败（可重试）
- ⚫ 离线模式

### 5.5 后台同步机制

```javascript
class SyncManager {
  constructor() {
    this.syncInterval = 30000;  // 30秒检查一次
    this.maxRetries = 3;
    this.retryDelay = 5000;     // 5秒后重试
  }
  
  async startAutoSync() {
    // 监听网络状态变化
    window.addEventListener('online', () => this.syncAll());
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.syncAll();
      }
    });
    
    // 定期同步
    setInterval(() => this.syncAll(), this.syncInterval);
  }
  
  async syncAll() {
    if (!navigator.onLine) return;
    // 同步用户数据
    await this.syncUserData();
    // 同步运动记录
    await this.syncExercises();
    // 清理同步队列
    await this.cleanupSyncQueue();
  }
}
```

---

## 6. 后端API设计

### 6.1 API基础信息

- **Base URL**: `https://api.exercisetracker.com/v1` （示例）
- **认证方式**: Bearer Token (JWT)
- **数据格式**: JSON
- **字符编码**: UTF-8

### 6.2 API端点

#### 认证相关

```
POST /api/auth/send-code
描述：发送手机验证码
请求：
{
  phone: "13800138000",
  type: "login" | "register"
}
响应：
{
  success: true,
  codeId: "xxx",        // 验证码ID，用于验证
  expireIn: 300         // 有效期（秒）
}

POST /api/auth/verify-code
描述：验证手机验证码并登录
请求：
{
  phone: "13800138000",
  code: "123456",
  codeId: "xxx"
}
响应：
{
  success: true,
  token: "jwt_token",
  user: { userId, nickname, phone, ... }
}

POST /api/auth/register/email
描述：邮箱注册
请求：
{
  email: "user@example.com",
  password: "hashed_password",
  nickname: "运动达人"
}
响应：
{
  success: true,
  token: "jwt_token",
  user: { userId, email, nickname, ... }
}

POST /api/auth/login/email
描述：邮箱登录
请求：
{
  email: "user@example.com",
  password: "hashed_password"
}
响应：
{
  success: true,
  token: "jwt_token",
  user: { userId, email, nickname, ... }
}

POST /api/auth/wechat
描述：微信登录
请求：
{
  code: "微信授权code"
}
响应：
{
  success: true,
  token: "jwt_token",
  user: { userId, nickname, avatar, ... },
  isNewUser: true
}

POST /api/auth/apple
描述：Apple ID登录
请求：
{
  identityToken: "xxx",
  authorizationCode: "xxx"
}
响应：
{
  success: true,
  token: "jwt_token",
  user: { userId, email, ... }
}

POST /api/auth/guest/upgrade
描述：游客升级为正式账号
请求：
{
  guestId: "xxx",           // 游客ID
  phone: "xxx",             // 新手机号
  code: "xxx"               // 验证码
}
响应：
{
  success: true,
  token: "jwt_token",
  user: { userId, ... }
}
```

#### 用户相关

```
GET /api/user/profile
描述：获取当前用户信息
请求头：Authorization: Bearer <token>
响应：
{
  success: true,
  user: { userId, phone, email, nickname, avatar, profile, ... }
}

PUT /api/user/profile
描述：更新用户信息
请求头：Authorization: Bearer <token>
请求：
{
  nickname?: "新昵称",
  avatar?: "base64或URL",
  profile?: {
    height: 175,
    weight: 70,
    age: 25,
    gender: "male",
    targetSteps: 12000,
    targetCalories: 500
  }
}
响应：
{
  success: true,
  user: { updated user object }
}

PUT /api/user/profile/password
描述：修改密码
请求：
{
  oldPassword: "xxx",
  newPassword: "yyy"
}

POST /api/user/profile/avatar
描述：上传头像
请求：multipart/form-data
响应：
{
  success: true,
  avatarUrl: "https://cdn.xxx.com/avatar/xxx.jpg"
}
```

#### 运动记录相关

```
GET /api/exercise/history
描述：获取运动历史
请求头：Authorization: Bearer <token>
查询参数：
- page: 页码（默认1）
- limit: 每页数量（默认20）
- startDate: 开始日期（YYYY-MM-DD）
- endDate: 结束日期（YYYY-MM-DD）
- type: 运动类型（running/walking/cycling）
响应：
{
  success: true,
  data: [exercise records],
  pagination: {
    page: 1,
    limit: 20,
    total: 100,
    totalPages: 5
  }
}

POST /api/exercise/sync
描述：批量同步运动记录
请求头：Authorization: Bearer <token>
请求：
{
  records: [
    {
      id: "local_id",
      action: "upsert" | "delete",
      data: { exercise object },
      localUpdatedAt: timestamp
    }
  ],
  lastSyncTime: timestamp  // 客户端记录的最近同步时间
}
响应：
{
  success: true,
  results: [
    { id: "local_id", status: "ok" | "conflict" | "error", cloudId: "cloud_id" }
  ],
  serverTime: timestamp,
  conflicts: [
    { local: {}, cloud: {}, resolvedBy: "local" | "cloud" | "manual" }
  ]
}

GET /api/exercise/:id
描述：获取单条运动记录详情
响应：
{
  success: true,
  exercise: { full exercise object with gpsPath }
}

DELETE /api/exercise/:id
描述：删除运动记录
响应：
{
  success: true
}
```

#### 步数相关

```
GET /api/steps/history
描述：获取步数历史
查询参数：startDate, endDate
响应：
{
  success: true,
  data: [{ date, steps, goal }]
}

POST /api/steps/sync
描述：同步步数数据
请求：
{
  records: [{ date, steps, goal, records: [] }]
}
```

---

## 7. UI界面设计

### 7.1 页面结构

```
├── auth.html          # 登录/注册页
│   ├── 手机号登录
│   ├── 邮箱登录
│   ├── 微信登录
│   ├── Apple登录
│   └── 游客入口
│
├── profile.html       # 个人档案页
│   ├── 头像编辑
│   ├── 基本信息（昵称、性别、年龄）
│   ├── 身体数据（身高、体重）
│   ├── 运动目标设置
│   └── 账号绑定管理
│
├── index.html         # 主页面（增强）
│   ├── 今日页面（增强用户状态显示）
│   ├── 历史页面（日历视图+列表视图）
│   ├── 统计页面
│   └── 设置页面
│       ├── 账号管理
│       ├── 数据同步设置
│       └── 退出登录
```

### 7.2 登录页布局 (auth.html)

```
┌─────────────────────────────────┐
│         [Logo/品牌]             │
│                                  │
│  ┌───────────────────────────┐  │
│  │  手机号登录                 │  │
│  │  ┌─────────────────────┐  │  │
│  │  │ +86 ▼    输入手机号   │  │  │
│  │  └─────────────────────┘  │  │
│  │  ┌─────────────────────┐  │  │
│  │  │ 请输入验证码    [获取]│  │  │
│  │  └─────────────────────┘  │  │
│  │  [    登录 / 注册    ]     │  │
│  └───────────────────────────┘  │
│                                  │
│  ─────────── 其他方式 ──────────  │
│                                  │
│  [微信] [Apple] [邮箱登录]        │
│                                  │
│  登录即表示同意《用户协议》和       │
│  《隐私政策》                     │
└─────────────────────────────────┘
```

### 7.3 个人档案页布局 (profile.html)

```
┌─────────────────────────────────┐
│ ← 返回          个人资料          │
├─────────────────────────────────┤
│                                  │
│        ┌─────────┐              │
│        │  头像   │              │
│        │  点击   │              │
│        │  更换   │              │
│        └─────────┘              │
│                                  │
│  昵称                            │
│  ┌───────────────────────────┐  │
│  │ 运动达人                   │  │
│  └───────────────────────────┘  │
│                                  │
│  性别        [男] [女] [其他]     │
│                                  │
│  生日                            │
│  ┌───────────────────────────┐  │
│  │ 1990-01-01                │  │
│  └───────────────────────────┘  │
│                                  │
│  身高 (cm)    [ 175 ]            │
│  体重 (kg)    [ 70  ]            │
│                                  │
│  ─────── 运动目标 ───────        │
│                                  │
│  每日步数目标                    │
│  ┌───────────────────────────┐  │
│  │ 10000        [-][+]       │  │
│  └───────────────────────────┘  │
│                                  │
│  每日消耗目标 (千卡)             │
│  ┌───────────────────────────┐  │
│  │ 500          [-][+]       │  │
│  └───────────────────────────┘  │
│                                  │
│  ─────── 账号绑定 ───────        │
│                                  │
│  📱 手机号    138****8000  [解绑] │
│  ✉️ 邮箱      user@xxx.com [解绑] │
│  💬 微信      已绑定        [解绑]│
│  🍎 Apple     已绑定        [解绑]│
│                                  │
│       [ 保存修改 ]               │
└─────────────────────────────────┘
```

### 7.4 历史页面改版 (日历视图)

```
┌─────────────────────────────────┐
│ 历史记录          [日历][列表]   │
├─────────────────────────────────┤
│                                  │
│  < 2026年4月 >                   │
│                                  │
│  日   一   二   三   四   五   六 │
│  ─────────────────────────────  │
│         1    2    3    4    5     │
│  ●                    ●          │
│  6    7    8    9   10   11   12  │
│                 ●                │
│  ...                             │
│                                  │
│  ─────── 本月跑步 8次 ───────    │
│                                  │
│  ┌─────────────────────────────┐│
│  │ 🚩 4月21日  周二             ││
│  │ 📍 5.20 km  ⏱️ 32:15        ││
│  │ ⚡ 6:12/km  🔥 312千卡       ││
│  └─────────────────────────────┘│
│  ┌─────────────────────────────┐│
│  │ 🚩 4月19日  周日             ││
│  │ 📍 3.80 km  ⏱️ 24:30        ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

---

## 8. 技术实现细节

### 8.1 Service Worker 增强

```javascript
// sw.js 增强：离线支持
const CACHE_NAME = 'exercise-tracker-v4';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/auth.html',
  '/profile.html',
  '/app.js',
  '/styles.css'
];

// 动态缓存策略
self.addEventListener('fetch', event => {
  // API请求：网络优先，失败时用缓存
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }
  
  // 静态资源：缓存优先
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // 缓存新资源
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
```

### 8.2 BaaS服务选型建议

| 服务 | 免费额度 | 优点 | 缺点 |
|------|---------|------|------|
| **Supabase** | 500MB数据库，1GB文件存储 | PostgreSQL，实时订阅，Auth内置 | 国内访问一般 |
| **Firebase** | 1GB Firestore，5GB存储 | 成熟，功能完整 | 国内访问受限 |
| **LeanCloud** | 1TB请求，1GB存储 | 国内访问快 | 免费额度较小 |
| **Parse Server** | 自托管 | 完全可控 | 需要服务器 |

**推荐**：对于个人开发者，**Supabase** 是最佳选择（免费、功能完整、API设计好）。

### 8.3 安全性考虑

1. **密码存储**：使用bcrypt或argon2哈希，不存储明文
2. **JWT**：短期访问令牌（1小时）+ 长期刷新令牌（7天）
3. **验证码**：限制频率（1分钟1次），有效期5分钟
4. **数据加密**：敏感字段（手机号）可选择性加密存储
5. **CORS**：API仅允许特定域名访问

---

## 9. 迁移计划（从v3到v4）

### 9.1 数据迁移

```javascript
// 首次启动v4时执行迁移
async function migrateFromV3() {
  const v3Data = localStorage.getItem('exercise_data_v3');
  if (!v3Data) return;
  
  const data = JSON.parse(v3Data);
  
  // 转换为IndexedDB格式
  const exercises = data.runs.map(run => ({
    id: `v3_${run.id}`,
    userId: 'guest_default',
    type: 'running',
    // ... 映射其他字段
    syncStatus: 'pending'
  }));
  
  // 保存到IndexedDB
  const db = new LocalDB();
  await db.init();
  for (const exercise of exercises) {
    await db.saveExercise(exercise);
  }
  
  // 标记迁移完成
  localStorage.setItem('migration_completed', 'v4');
}
```

### 9.2 向后兼容

- v4同时支持localStorage和IndexedDB
- 渐进式迁移：旧数据留在localStorage，新数据写入IndexedDB
- 未来版本（v5）可完全移除localStorage支持

---

## 10. 实现优先级

### P0（必须）
1. IndexedDB存储层封装
2. 游客账号系统
3. 登录/注册UI页面

### P1（重要）
4. 邮箱+密码登录
5. 个人档案编辑
6. 数据同步基础实现

### P2（增强）
7. 微信/Apple登录
8. 运动历史日历视图
9. 冲突解决UI

### P3（优化）
10. 后台同步优化
11. 离线能力增强
12. 多设备同步冲突处理

---

*文档版本：1.0 | 最后更新：2026-04-21*
