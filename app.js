// ===== 求职记录 - 核心逻辑（公司-岗位两级结构）=====

const STORAGE_KEY = 'job_tracker_data';
const JOB_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const JOB_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const STATUS_MAP = {
  pending: { label: '待投递', class: 'status-pending' },
  applied: { label: '已投递', class: 'status-applied' },
  interviewing: { label: '面试中', class: 'status-interviewing' },
  offer: { label: '已offer', class: 'status-offer' },
  rejected: { label: '已拒绝', class: 'status-rejected' },
  failed: { label: '已挂', class: 'status-failed' },
};

const STATUS_COLORS = {
  pending: '#718096',
  applied: '#3182ce',
  interviewing: '#b7791f',
  offer: '#2f855a',
  rejected: '#c53030',
  failed: '#9b2c2c',
};

const COMPANY_TYPE_MAP = {
  private: '私企',
  state: '央国企',
};

const FINISHED_STATUSES = ['offer', 'rejected', 'failed'];

const EVENT_STAGE_MAP = {
  application: '投递简历',
  screening: '简历筛选',
  writtenTest: '笔试',
  firstInterview: '初试',
  secondInterview: '复试',
  finalInterview: '终面',
  offer: 'Offer',
  other: '其他进展',
};

const EVENT_RESULT_MAP = {
  pending: '待进行',
  passed: '通过',
  failed: '未通过',
  cancelled: '已取消',
};

const RESULT_STAGES = ['screening', 'writtenTest', 'firstInterview', 'secondInterview', 'finalInterview'];
const VALID_EVENT_RESULTS = ['', ...Object.keys(EVENT_RESULT_MAP)];
const LEGACY_EVENT_STAGES = {
  '投递简历': 'application',
  '简历投递': 'application',
  '简历筛选': 'screening',
  'HR初筛': 'screening',
  '笔试': 'writtenTest',
  '初试': 'firstInterview',
  '复试': 'secondInterview',
  '终面': 'finalInterview',
  'Offer': 'offer',
};

// ===== 数据层 =====
let state = {
  companies: [],
  selectedCompanyId: null,
  selectedPositionId: null,
  expandedIds: new Set(),
  searchKeyword: '',
  statusFilter: 'all',
  currentView: 'records',
  statsRange: '30',
};

let jobImageAbortController = null;
let jobImageRequestId = 0;

function getBundledCompanies() {
  const data = window.DEFAULT_JOB_DATA;
  if (!data || !Array.isArray(data.companies)) return [];
  return JSON.parse(JSON.stringify(data.companies));
}

// 统一当前数据结构，并兼容旧版 deadline 字段
function normalizeCompanies(list) {
  let changed = false;
  const companies = list.map(source => {
    const company = { ...source };
    const companyType = COMPANY_TYPE_MAP[company.companyType] ? company.companyType : '';
    if (company.companyType !== companyType) changed = true;
    company.companyType = companyType;

    company.positions = Array.isArray(company.positions)
      ? company.positions.map(sourcePosition => {
        const position = { ...sourcePosition };
        if (!Object.prototype.hasOwnProperty.call(position, 'applicationDate')) {
          position.applicationDate = position.deadline || '';
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(position, 'deadline')) {
          delete position.deadline;
          changed = true;
        }
        position.timeline = Array.isArray(position.timeline)
          ? position.timeline.map(sourceEvent => {
            const timelineEvent = { ...sourceEvent };
            const inferredStage = LEGACY_EVENT_STAGES[timelineEvent.event] || 'other';
            const stage = EVENT_STAGE_MAP[timelineEvent.stage] ? timelineEvent.stage : inferredStage;
            const result = VALID_EVENT_RESULTS.includes(timelineEvent.result) ? timelineEvent.result : '';
            if (timelineEvent.stage !== stage || timelineEvent.result !== result) changed = true;
            timelineEvent.stage = stage;
            timelineEvent.result = result;
            return timelineEvent;
          })
          : [];
        return position;
      })
      : [];
    return company;
  });
  return { companies, changed };
}

// 优先加载浏览器数据；首次打开时使用随页面提供的初始数据
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.companies = normalizeCompanies(getBundledCompanies()).companies;
      if (state.companies.length > 0) saveData();
      return;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.companies)) {
      throw new Error('本地数据格式不正确');
    }

    let companies = parsed.companies;
    const needsMigration = companies.length > 0 && !companies[0].positions;
    if (needsMigration) {
      companies = migrateOldFormat(companies);
    }

    const normalized = normalizeCompanies(companies);
    state.companies = normalized.companies;
    if (needsMigration || normalized.changed) saveData();
  } catch (e) {
    console.error('加载本地数据失败', e);
    state.companies = normalizeCompanies(getBundledCompanies()).companies;
    if (state.companies.length > 0) {
      saveData();
      showToast('本地数据异常，已恢复初始数据');
    } else {
      showToast('本地数据读取失败，请导入备份');
    }
  }
}

// 旧格式迁移：公司直接含岗位字段 → 公司 + positions 数组
function migrateOldFormat(oldList) {
  return oldList.map(c => {
    const pos = {
      id: genId('p'),
      position: c.position || '',
      salary: c.salary || '',
      channel: c.channel || '',
      applicationDate: c.applicationDate || c.deadline || '',
      status: c.status || 'pending',
      note: c.note || '',
      timeline: c.timeline || [],
      interviewPrep: c.interviewPrep || '',
      experienceSummary: c.experienceSummary || '',
      createdAt: c.createdAt || todayStr(),
      updatedAt: c.updatedAt || todayStr(),
    };
    return {
      id: c.id || genId('c'),
      name: c.name || '',
      location: c.location || '',
      companyType: COMPANY_TYPE_MAP[c.companyType] ? c.companyType : '',
      note: '',
      createdAt: c.createdAt || todayStr(),
      positions: [pos],
    };
  });
}

// 自动保存到浏览器本地存储
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ companies: state.companies }));
    updateSaveButton();
    if (state.currentView === 'stats') renderStats();
  } catch (e) {
    console.error('本地保存失败', e);
    showToast('保存失败，请导出备份');
  }
}

function updateSaveButton() {
  const btn = document.getElementById('btn-save');
  if (!btn) return;
  btn.textContent = '导出备份';
  btn.title = '将当前记录导出为 JSON 备份文件';
}

function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function todayStr(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===== 公司操作 =====
function addCompany(data) {
  const now = todayStr();
  const position = {
    id: genId('p'),
    position: data.position.trim(),
    salary: data.salary || '',
    channel: data.channel || '',
    applicationDate: data.applicationDate || '',
    status: data.status || 'pending',
    note: data.positionNote || '',
    timeline: [],
    interviewPrep: '',
    experienceSummary: '',
    createdAt: now,
    updatedAt: now,
  };
  if (position.status !== 'pending') {
    position.timeline.push({
      id: genId('t'),
      date: position.applicationDate || now,
      event: '投递简历',
      stage: 'application',
      result: '',
    });
  }
  const company = {
    id: genId('c'),
    name: data.companyName.trim(),
    location: data.location || '',
    companyType: COMPANY_TYPE_MAP[data.companyType] ? data.companyType : '',
    note: data.companyNote || '',
    createdAt: now,
    positions: [position],
  };
  state.companies.unshift(company);
  saveData();
  return { company, position };
}

function updateCompany(id, updates) {
  const c = getCompany(id);
  if (!c) return;
  Object.assign(c, updates);
  saveData();
}

function deleteCompany(id) {
  state.companies = state.companies.filter(x => x.id !== id);
  if (state.selectedCompanyId === id) {
    state.selectedCompanyId = null;
    state.selectedPositionId = null;
  }
  state.expandedIds.delete(id);
  saveData();
}

function getCompany(id) {
  return state.companies.find(x => x.id === id);
}

// ===== 岗位操作 =====
function addPosition(companyId, data) {
  const c = getCompany(companyId);
  if (!c) return null;
  const now = todayStr();
  const position = {
    id: genId('p'),
    position: data.position.trim(),
    salary: data.salary || '',
    channel: data.channel || '',
    applicationDate: data.applicationDate || '',
    status: data.status || 'pending',
    note: data.positionNote || '',
    timeline: [],
    interviewPrep: '',
    experienceSummary: '',
    createdAt: now,
    updatedAt: now,
  };
  if (position.status !== 'pending') {
    position.timeline.push({
      id: genId('t'),
      date: position.applicationDate || now,
      event: '投递简历',
      stage: 'application',
      result: '',
    });
  }
  c.positions.push(position);
  saveData();
  return position;
}

function updatePosition(companyId, positionId, updates) {
  const p = getPosition(companyId, positionId);
  if (!p) return;
  Object.assign(p, updates);
  p.updatedAt = todayStr();
  saveData();
}

function deletePosition(companyId, positionId) {
  const c = getCompany(companyId);
  if (!c) return;
  c.positions = c.positions.filter(p => p.id !== positionId);
  if (state.selectedPositionId === positionId) {
    state.selectedPositionId = c.positions.length > 0 ? c.positions[0].id : null;
  }
  saveData();
}

function getPosition(companyId, positionId) {
  const c = getCompany(companyId);
  if (!c) return null;
  return c.positions.find(p => p.id === positionId);
}

function getCurrentPosition() {
  return getPosition(state.selectedCompanyId, state.selectedPositionId);
}

// ===== 时间线操作 =====
function addEvent(companyId, positionId, date, event, stage = 'other', result = '') {
  const p = getPosition(companyId, positionId);
  if (!p) return;
  const safeStage = EVENT_STAGE_MAP[stage] ? stage : 'other';
  const safeResult = RESULT_STAGES.includes(safeStage) && VALID_EVENT_RESULTS.includes(result) ? result : '';
  p.timeline.push({
    id: genId('t'),
    date,
    event: event.trim() || EVENT_STAGE_MAP[safeStage],
    stage: safeStage,
    result: safeResult,
  });
  p.timeline.sort((a, b) => a.date.localeCompare(b.date));
  p.updatedAt = todayStr();
  saveData();
}

function deleteEvent(companyId, positionId, eventId) {
  const p = getPosition(companyId, positionId);
  if (!p) return;
  p.timeline = p.timeline.filter(t => t.id !== eventId);
  p.updatedAt = todayStr();
  saveData();
}

// ===== 统计计算 =====
function parseDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function getApplicationDate(p) {
  if (parseDateString(p.applicationDate)) return p.applicationDate;
  const applicationDates = (p.timeline || [])
    .filter(event => event.stage === 'application' && parseDateString(event.date))
    .map(event => event.date)
    .sort();
  return applicationDates[0] || '';
}

function isAppliedPosition(p) {
  return p.status !== 'pending' || Boolean(getApplicationDate(p));
}

function getRangeStart(range, referenceDate) {
  if (range === 'all') return null;
  const days = Number(range);
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  start.setDate(start.getDate() - days + 1);
  return start;
}

function isDateInRange(dateString, range, referenceDate) {
  const date = parseDateString(dateString);
  if (!date) return range === 'all';
  if (range === 'all') return true;
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  return date >= getRangeStart(range, referenceDate) && date <= end;
}

function getLatestFirstInterviewResult(p) {
  const resolved = (p.timeline || [])
    .filter(event => event.stage === 'firstInterview' && ['passed', 'failed'].includes(event.result))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return resolved.length > 0 ? resolved[resolved.length - 1].result : '';
}

function buildDailySeries(scopedPositions, range, referenceDate) {
  const counts = new Map();
  scopedPositions.forEach(({ applicationDate }) => {
    if (applicationDate) counts.set(applicationDate, (counts.get(applicationDate) || 0) + 1);
  });

  if (range === 'all') {
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  }

  const series = [];
  const cursor = getRangeStart(range, referenceDate);
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  while (cursor <= end) {
    const date = todayStr(cursor);
    series.push({ date, count: counts.get(date) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

function calculateStatistics(companies, range = '30', referenceDate = new Date()) {
  const allPositions = companies.flatMap(company =>
    (company.positions || []).map(position => ({ company, position }))
  );
  const appliedPositions = allPositions
    .filter(({ position }) => isAppliedPosition(position))
    .map(item => ({ ...item, applicationDate: getApplicationDate(item.position) }));
  const scopedPositions = appliedPositions.filter(item =>
    isDateInRange(item.applicationDate, range, referenceDate)
  );

  const companyTypes = { state: 0, private: 0, unclassified: 0 };
  companies.forEach(company => {
    if (company.companyType === 'state') companyTypes.state += 1;
    else if (company.companyType === 'private') companyTypes.private += 1;
    else companyTypes.unclassified += 1;
  });

  const statuses = Object.fromEntries(Object.keys(STATUS_MAP).map(status => [status, 0]));
  allPositions.forEach(({ position }) => {
    if (Object.prototype.hasOwnProperty.call(statuses, position.status)) statuses[position.status] += 1;
  });

  const channels = {};
  scopedPositions.forEach(({ position }) => {
    const channel = (position.channel || '').trim() || '未填写';
    channels[channel] = (channels[channel] || 0) + 1;
  });

  const firstInterviewPositions = scopedPositions.filter(({ position }) =>
    (position.timeline || []).some(event => event.stage === 'firstInterview')
  );
  const firstPassedPositions = firstInterviewPositions.filter(({ position }) =>
    getLatestFirstInterviewResult(position) === 'passed'
  );
  const firstFailedPositions = firstInterviewPositions.filter(({ position }) =>
    getLatestFirstInterviewResult(position) === 'failed'
  );
  const completedFirstInterviews = firstPassedPositions.length + firstFailedPositions.length;
  const funnelOffers = firstPassedPositions.filter(({ position }) =>
    position.status === 'offer' || (position.timeline || []).some(event => event.stage === 'offer')
  ).length;

  return {
    range,
    totalCompanies: companies.length,
    totalPositions: allPositions.length,
    applicationCount: scopedPositions.length,
    interviewingCount: allPositions.filter(({ position }) => position.status === 'interviewing').length,
    offerCount: allPositions.filter(({ position }) => position.status === 'offer').length,
    firstInterviewPassRate: completedFirstInterviews > 0
      ? Math.round((firstPassedPositions.length / completedFirstInterviews) * 100)
      : null,
    completedFirstInterviews,
    companyTypes,
    statuses,
    channels: Object.entries(channels)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')),
    daily: buildDailySeries(scopedPositions, range, referenceDate),
    funnel: {
      applied: scopedPositions.length,
      firstInterview: firstInterviewPositions.length,
      firstPassed: firstPassedPositions.length,
      offer: funnelOffers,
    },
    undatedAppliedCount: appliedPositions.filter(item => !item.applicationDate).length,
  };
}

// ===== 筛选与排序 =====
function getFilteredCompanies() {
  let list = [...state.companies];
  if (state.searchKeyword) {
    const kw = state.searchKeyword.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(kw) ||
      c.positions.some(p => p.position.toLowerCase().includes(kw))
    );
  }
  list.sort((a, b) => {
    const aDates = a.positions.length > 0 ? a.positions.map(p => p.updatedAt) : [a.createdAt];
    const bDates = b.positions.length > 0 ? b.positions.map(p => p.updatedAt) : [b.createdAt];
    const aDate = aDates.sort().pop();
    const bDate = bDates.sort().pop();
    return bDate.localeCompare(aDate);
  });
  return list;
}

function positionMatchesFilter(p) {
  if (state.statusFilter === 'all') return true;
  return p.status === state.statusFilter;
}

function getLastEventDate(p) {
  if (!p.timeline || p.timeline.length === 0) return p.applicationDate || p.createdAt;
  return p.timeline[p.timeline.length - 1].date;
}

// ===== 渲染：公司列表 =====
function renderCompanyList() {
  const container = document.getElementById('company-list');
  const list = getFilteredCompanies();

  if (list.length === 0) {
    container.innerHTML = '<div class="list-empty">暂无公司记录</div>';
    return;
  }

  container.innerHTML = list.map(c => {
    const expanded = state.expandedIds.has(c.id);
    const visiblePositions = c.positions.filter(p => positionMatchesFilter(p));
    const posCount = c.positions.length;
    const companyMeta = [COMPANY_TYPE_MAP[c.companyType], c.location].filter(Boolean).join(' · ');

    let positionsHtml = '';
    if (expanded) {
      if (visiblePositions.length === 0) {
        positionsHtml = '<div class="position-item" style="color:var(--text-light);font-size:12px;padding-left:36px">无符合筛选的岗位</div>';
      } else {
        positionsHtml = visiblePositions.map(p => {
          const status = STATUS_MAP[p.status] || STATUS_MAP.pending;
          const active = (state.selectedCompanyId === c.id && state.selectedPositionId === p.id) ? 'active' : '';
          const lastDate = getLastEventDate(p);
          return `
            <button type="button" class="position-item ${active}" data-company-id="${c.id}" data-position-id="${p.id}" aria-current="${active ? 'true' : 'false'}">
              <span class="position-item-name">
                <span>${escapeHtml(p.position || '（未填岗位）')}</span>
                <span class="status-dot" style="background:${STATUS_COLORS[p.status]}" title="${status.label}"></span>
              </span>
              <span class="position-item-meta">
                <span>${status.label}</span>
                <span>最近: ${lastDate}</span>
              </span>
            </button>
          `;
        }).join('');
      }
    }

    return `
      <div class="company-group ${expanded ? 'expanded' : ''}" data-company-id="${c.id}">
        <button type="button" class="company-header" aria-expanded="${expanded}">
          <span class="company-toggle">▶</span>
          <span class="company-header-info">
            <span class="company-header-name">${escapeHtml(c.name)}</span>
            <span class="company-header-meta">${escapeHtml(companyMeta)}</span>
          </span>
          <span class="company-position-count">${posCount}个岗位</span>
        </button>
        <div class="position-items">${positionsHtml}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.company-header').forEach(el => {
    el.addEventListener('click', () => {
      const group = el.closest('.company-group');
      const cid = group.dataset.companyId;
      if (state.expandedIds.has(cid)) {
        state.expandedIds.delete(cid);
      } else {
        state.expandedIds.add(cid);
      }
      renderCompanyList();
    });
  });

  container.querySelectorAll('.position-item').forEach(el => {
    if (el.dataset.positionId) {
      el.addEventListener('click', () => {
        state.selectedCompanyId = el.dataset.companyId;
        state.selectedPositionId = el.dataset.positionId;
        renderCompanyList();
        renderDetail();
      });
    }
  });
}

// ===== 渲染：详情 =====
function renderDetail() {
  const emptyEl = document.getElementById('detail-empty');
  const contentEl = document.getElementById('detail-content');

  if (!state.selectedCompanyId || !state.selectedPositionId) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }

  const c = getCompany(state.selectedCompanyId);
  const p = getCurrentPosition();
  if (!c || !p) {
    state.selectedCompanyId = null;
    state.selectedPositionId = null;
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  contentEl.hidden = false;

  document.getElementById('detail-company-name').textContent = c.name;
  document.getElementById('field-company-name').value = c.name;
  document.getElementById('field-company-location').value = c.location || '';
  document.getElementById('field-company-type').value = c.companyType || '';
  document.getElementById('field-company-note').value = c.note || '';

  renderPositionTabs(c);

  document.getElementById('position-detail').hidden = false;
  document.getElementById('detail-position-name').textContent = p.position || '（未填岗位）';
  const badge = document.getElementById('detail-status-badge');
  const status = STATUS_MAP[p.status] || STATUS_MAP.pending;
  badge.textContent = status.label;
  badge.className = 'status-badge ' + status.class;

  document.getElementById('field-position').value = p.position || '';
  document.getElementById('field-salary').value = p.salary || '';
  document.getElementById('field-channel').value = p.channel || '';
  document.getElementById('field-application-date').value = p.applicationDate || '';
  document.getElementById('field-status').value = p.status;
  document.getElementById('field-position-note').value = p.note || '';
  document.getElementById('field-interview-prep').value = p.interviewPrep || '';
  document.getElementById('field-summary').value = p.experienceSummary || '';

  document.getElementById('section-summary').hidden = !FINISHED_STATUSES.includes(p.status);

  renderTimeline(p);

  document.getElementById('new-event-date').value = todayStr();
  document.getElementById('new-event-stage').value = 'other';
  document.getElementById('new-event-result').value = '';
  document.getElementById('new-event-text').value = '';
  updateEventResultVisibility();
}

function renderPositionTabs(c) {
  const container = document.getElementById('position-tabs');
  container.innerHTML = c.positions.map(p => {
    const active = p.id === state.selectedPositionId ? 'active' : '';
    return `
      <button type="button" class="position-tab ${active}" data-position-id="${p.id}" aria-pressed="${active ? 'true' : 'false'}">
        <span class="tab-dot" style="background:${STATUS_COLORS[p.status]}"></span>
        <span>${escapeHtml(p.position || '（未填岗位）')}</span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.position-tab').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedPositionId = el.dataset.positionId;
      renderCompanyList();
      renderDetail();
    });
  });
}

function renderTimeline(p) {
  const container = document.getElementById('timeline');
  if (!p.timeline || p.timeline.length === 0) {
    container.innerHTML = '<div class="list-empty" style="padding:16px">暂无进展记录</div>';
    return;
  }
  container.innerHTML = p.timeline.map(t => `
    <div class="timeline-item">
      <span class="timeline-item-date">${t.date}</span>
      <span class="timeline-item-event">
        <span class="timeline-event-tags">
          <span class="timeline-tag">${EVENT_STAGE_MAP[t.stage] || EVENT_STAGE_MAP.other}</span>
          ${t.result ? `<span class="timeline-tag result-${t.result}">${EVENT_RESULT_MAP[t.result]}</span>` : ''}
        </span>
        ${t.event && t.event !== EVENT_STAGE_MAP[t.stage] ? escapeHtml(t.event) : ''}
      </span>
      <span class="timeline-item-actions">
        <button class="btn-link" data-event-id="${t.id}" title="删除">删除</button>
      </span>
    </div>
  `).join('');

  container.querySelectorAll('.btn-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const companyId = state.selectedCompanyId;
      const positionId = state.selectedPositionId;
      const eventId = btn.dataset.eventId;
      showConfirm('确定删除这条进展记录吗？', () => {
        deleteEvent(companyId, positionId, eventId);
        renderDetail();
        renderCompanyList();
        showToast('已删除');
      });
    });
  });
}

// ===== 渲染：数据统计 =====
function renderDonut(companyTypes) {
  const items = [
    { label: '央国企', value: companyTypes.state, color: '#275bd6' },
    { label: '私企', value: companyTypes.private, color: '#40a69a' },
    { label: '未分类', value: companyTypes.unclassified, color: '#cbd3df' },
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let current = 0;
  const segments = items.map(item => {
    const start = current;
    current += total > 0 ? (item.value / total) * 100 : 0;
    return `${item.color} ${start}% ${current}%`;
  }).join(', ');
  const background = total > 0 ? `conic-gradient(${segments})` : 'var(--line)';
  const legend = items.map(item => `
    <li><span class="chart-dot" style="background:${item.color}"></span><span>${item.label}</span><strong>${item.value}</strong></li>
  `).join('');
  return `
    <div class="donut-layout">
      <div class="donut-chart" style="background:${background}" role="img" aria-label="企业性质：${items.map(item => `${item.label} ${item.value} 家`).join('，')}">
        <div class="donut-center"><strong>${total}</strong><span>家公司</span></div>
      </div>
      <ul class="chart-legend">${legend}</ul>
    </div>
  `;
}

function renderDailyChart(daily) {
  if (daily.length === 0 || daily.every(item => item.count === 0)) {
    return '<div class="chart-empty">当前范围内暂无带日期的投递记录</div>';
  }
  const max = Math.max(...daily.map(item => item.count), 1);
  return `
    <div class="daily-chart-scroll">
      <div class="daily-chart" style="--day-count:${daily.length}" role="img" aria-label="每日投递数量：${daily.filter(item => item.count).map(item => `${item.date} ${item.count} 份`).join('，')}">
        ${daily.map((item, index) => {
          const height = item.count === 0 ? 3 : Math.max(14, Math.round((item.count / max) * 118));
          const showLabel = daily.length <= 31 || index % 7 === 0 || index === daily.length - 1;
          return `
            <div class="daily-column" title="${item.date}：${item.count} 份">
              <span class="daily-value">${item.count || ''}</span>
              <span class="daily-bar ${item.count === 0 ? 'empty' : ''}" style="height:${height}px"></span>
              <span class="daily-label">${showLabel ? item.date.slice(5) : ''}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderHorizontalBars(items, emptyText) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(...items.map(item => item.count), 1);
  if (total === 0) return `<div class="chart-empty">${emptyText}</div>`;
  return `<div class="horizontal-bars">${items.map(item => `
    <div class="horizontal-bar-row">
      <div class="horizontal-bar-label"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>
      <div class="horizontal-bar-track" role="img" aria-label="数量 ${item.count}">
        <span style="width:${Math.round((item.count / max) * 100)}%;background:${item.color || 'var(--brand)'}"></span>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderStats() {
  const container = document.getElementById('stats-content');
  if (!container) return;
  const stats = calculateStatistics(state.companies, state.statsRange);
  const classified = stats.companyTypes.state + stats.companyTypes.private;
  const completeness = stats.totalCompanies > 0 ? Math.round((classified / stats.totalCompanies) * 100) : 0;
  const statusItems = Object.entries(STATUS_MAP).map(([key, value]) => ({
    label: value.label,
    count: stats.statuses[key],
    color: STATUS_COLORS[key],
  }));
  const channelItems = stats.channels.map(item => ({ ...item, label: item.name }));
  const funnelItems = [
    { label: '已投递', count: stats.funnel.applied, color: '#275bd6' },
    { label: '参加初试', count: stats.funnel.firstInterview, color: '#4f82e8' },
    { label: '初试通过', count: stats.funnel.firstPassed, color: '#40a69a' },
    { label: '获得 Offer', count: stats.funnel.offer, color: '#15805f' },
  ];
  const funnelBase = Math.max(stats.funnel.applied, 1);
  const rangeLabel = state.statsRange === 'all' ? '全部记录' : `近 ${state.statsRange} 天`;

  const notices = [];
  if (stats.companyTypes.unclassified > 0) notices.push(`${stats.companyTypes.unclassified} 家公司尚未填写企业性质`);
  if (state.statsRange !== 'all' && stats.undatedAppliedCount > 0) notices.push(`${stats.undatedAppliedCount} 个已投递岗位缺少日期，未计入当前时间范围`);
  if (stats.completedFirstInterviews === 0) notices.push('暂无已记录结果的初试样本，通过率暂不可计算');

  container.innerHTML = `
    <div class="metric-grid">
      <article class="metric-card"><span>${rangeLabel}投递</span><strong>${stats.applicationCount}</strong><small>个岗位</small></article>
      <article class="metric-card"><span>正在面试</span><strong>${stats.interviewingCount}</strong><small>个岗位 · 全部记录</small></article>
      <article class="metric-card"><span>获得 Offer</span><strong>${stats.offerCount}</strong><small>个岗位 · 全部记录</small></article>
      <article class="metric-card"><span>初试通过率</span><strong>${stats.firstInterviewPassRate === null ? '—' : `${stats.firstInterviewPassRate}%`}</strong><small>${stats.completedFirstInterviews > 0 ? `${stats.completedFirstInterviews} 个有效样本` : '暂无有效样本'}</small></article>
    </div>
    ${notices.length > 0 ? `<div class="stats-notice" role="status">${notices.map(notice => `<span>${notice}</span>`).join('')}</div>` : ''}
    <div class="stats-grid">
      <article class="chart-card chart-card-wide">
        <div class="chart-heading"><div><h3>每日投递</h3><p>${rangeLabel}，按岗位统计</p></div></div>
        ${renderDailyChart(stats.daily)}
      </article>
      <article class="chart-card">
        <div class="chart-heading"><div><h3>企业性质</h3><p>按公司统计 · 完整度 ${completeness}%</p></div></div>
        ${renderDonut(stats.companyTypes)}
      </article>
      <article class="chart-card">
        <div class="chart-heading"><div><h3>求职状态</h3><p>全部岗位的当前状态</p></div></div>
        ${renderHorizontalBars(statusItems, '暂无岗位记录')}
      </article>
      <article class="chart-card">
        <div class="chart-heading"><div><h3>投递渠道</h3><p>${rangeLabel}</p></div></div>
        ${renderHorizontalBars(channelItems, '当前范围内暂无投递渠道数据')}
      </article>
      <article class="chart-card">
        <div class="chart-heading"><div><h3>求职漏斗</h3><p>${rangeLabel}，使用结构化进展</p></div></div>
        <div class="funnel-chart">${funnelItems.map(item => {
          const width = item.count > 0 ? Math.max(10, Math.round((item.count / funnelBase) * 100)) : 0;
          return `
            <div class="funnel-row">
              <div class="funnel-label"><span>${item.label}</span><strong>${item.count}</strong></div>
              <div class="funnel-track" role="img" aria-label="${item.label} ${item.count}"><span style="width:${width}%;background:${item.color}"></span></div>
            </div>
          `;
        }).join('')}</div>
      </article>
    </div>
  `;
}

function setCurrentView(view) {
  state.currentView = view === 'stats' ? 'stats' : 'records';
  const showStats = state.currentView === 'stats';
  const recordsPage = document.getElementById('records-page');
  const statsPage = document.getElementById('stats-page');
  recordsPage.hidden = showStats;
  statsPage.hidden = !showStats;
  recordsPage.style.display = showStats ? 'none' : '';
  statsPage.style.display = showStats ? 'block' : 'none';
  document.getElementById('nav-records').className = `view-switch ${showStats ? '' : 'active'}`.trim();
  document.getElementById('nav-stats').className = `view-switch ${showStats ? 'active' : ''}`.trim();
  document.getElementById('nav-records').setAttribute('aria-pressed', String(!showStats));
  document.getElementById('nav-stats').setAttribute('aria-pressed', String(showStats));
  if (showStats) renderStats();
}

function updateEventResultVisibility() {
  const stage = document.getElementById('new-event-stage').value;
  const group = document.getElementById('new-event-result-group');
  group.hidden = !RESULT_STAGES.includes(stage);
  if (group.hidden) document.getElementById('new-event-result').value = '';
}

// ===== 工具函数 =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2000);
}

// ===== 确认弹窗 =====
let confirmCallback = null;
function showConfirm(message, callback) {
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok').textContent = '确定';
  document.getElementById('modal-confirm').hidden = false;
  confirmCallback = callback;
}

function hideConfirm() {
  document.getElementById('modal-confirm').hidden = true;
  confirmCallback = null;
}

// ===== 添加公司弹窗 =====
function setJobImageStatus(message, type = '') {
  const status = document.getElementById('job-image-status');
  status.textContent = message;
  status.className = `ai-import-status ${type ? `is-${type}` : ''}`.trim();
}

function setJobImageBusy(busy) {
  document.getElementById('btn-job-image').disabled = busy;
  document.getElementById('btn-job-image-reselect').disabled = busy;
}

function resetJobImageImport() {
  jobImageRequestId += 1;
  if (jobImageAbortController) jobImageAbortController.abort();
  jobImageAbortController = null;
  const input = document.getElementById('file-job-image');
  const name = document.getElementById('job-image-name');
  input.value = '';
  name.textContent = '';
  name.hidden = true;
  document.getElementById('btn-job-image-reselect').hidden = true;
  setJobImageBusy(false);
  setJobImageStatus('识别结果会填入下方表单，确认后再保存。');
}

function readJobImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target.result);
    reader.onerror = () => reject(new Error('读取截图失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}

function normalizeJobExtractionData(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('识别结果格式不正确');
  if (payload.isJobPosting !== true) throw new Error('这张图片不像招聘信息，请更换截图');
  if (!payload.company || typeof payload.company !== 'object'
      || !payload.position || typeof payload.position !== 'object') {
    throw new Error('识别结果缺少公司或岗位信息');
  }

  const stringValue = value => typeof value === 'string' ? value.trim() : '';
  const companyType = ['private', 'state'].includes(payload.company.companyType)
    ? payload.company.companyType
    : '';
  return {
    company: {
      name: stringValue(payload.company.name),
      location: stringValue(payload.company.location),
      companyType,
      note: stringValue(payload.company.note),
    },
    position: {
      name: stringValue(payload.position.name),
      salary: stringValue(payload.position.salary),
      channel: stringValue(payload.position.channel),
      applicationDate: '',
      status: 'pending',
      note: stringValue(payload.position.note),
    },
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [],
  };
}

function addCompanyFormHasContent() {
  return [
    'modal-company-name', 'modal-company-location', 'modal-company-type', 'modal-company-note',
    'modal-position', 'modal-salary', 'modal-channel', 'modal-application-date', 'modal-position-note',
  ].some(id => document.getElementById(id).value.trim() !== '');
}

function applyJobExtractionData(data) {
  document.getElementById('modal-company-name').value = data.company.name;
  document.getElementById('modal-company-location').value = data.company.location;
  document.getElementById('modal-company-type').value = data.company.companyType;
  document.getElementById('modal-company-note').value = data.company.note;
  document.getElementById('modal-position').value = data.position.name;
  document.getElementById('modal-salary').value = data.position.salary;
  document.getElementById('modal-channel').value = data.position.channel;
  document.getElementById('modal-application-date').value = '';
  document.getElementById('modal-status').value = 'pending';
  document.getElementById('modal-position-note').value = data.position.note;
  const suffix = data.warnings.length > 0 ? `，${data.warnings.length} 项内容需要注意` : '';
  setJobImageStatus(`识别完成${suffix}，请检查后保存。`, 'success');
  document.getElementById('modal-company-name').focus();
}

async function handleJobImageFile(file) {
  if (!file) return;
  if (!JOB_IMAGE_TYPES.includes(file.type)) {
    setJobImageStatus('仅支持 PNG、JPEG 或 WebP 图片。', 'error');
    showToast('截图格式不支持');
    return;
  }
  if (file.size > JOB_IMAGE_MAX_BYTES) {
    setJobImageStatus('图片超过 10 MB，请压缩后重试。', 'error');
    showToast('截图不能超过 10 MB');
    return;
  }

  const requestId = ++jobImageRequestId;
  const fileName = document.getElementById('job-image-name');
  fileName.textContent = file.name || '已选择截图';
  fileName.hidden = false;
  document.getElementById('btn-job-image-reselect').hidden = false;
  setJobImageBusy(true);
  setJobImageStatus('正在读取并识别截图…', 'loading');
  jobImageAbortController = new AbortController();

  try {
    const image = await readJobImage(file);
    const response = await fetch('/api/job-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      signal: jobImageAbortController.signal,
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result?.error?.message || '截图识别失败，请稍后重试');
    }
    const data = normalizeJobExtractionData(result.data);
    if (requestId !== jobImageRequestId) return;
    if (addCompanyFormHasContent()) {
      setJobImageStatus('识别完成，等待确认是否覆盖当前内容。', 'success');
      showConfirm('当前表单已有内容，是否用截图识别结果覆盖？', () => applyJobExtractionData(data));
    } else {
      applyJobExtractionData(data);
    }
  } catch (error) {
    if (requestId !== jobImageRequestId || error.name === 'AbortError') return;
    const message = error instanceof TypeError
      ? '识别服务不可用，请通过 start-ai.bat 启动 AI 模式'
      : error.message;
    setJobImageStatus(message, 'error');
    showToast(message);
  } finally {
    if (requestId === jobImageRequestId) {
      jobImageAbortController = null;
      setJobImageBusy(false);
    }
  }
}

function openAddCompanyModal() {
  document.getElementById('modal-company-name').value = '';
  document.getElementById('modal-company-location').value = '';
  document.getElementById('modal-company-type').value = '';
  document.getElementById('modal-company-note').value = '';
  document.getElementById('modal-position').value = '';
  document.getElementById('modal-salary').value = '';
  document.getElementById('modal-channel').value = '';
  document.getElementById('modal-application-date').value = '';
  document.getElementById('modal-status').value = 'pending';
  document.getElementById('modal-position-note').value = '';
  resetJobImageImport();
  document.getElementById('modal-add').hidden = false;
  setTimeout(() => document.getElementById('modal-company-name').focus(), 50);
}

function closeAddCompanyModal() {
  resetJobImageImport();
  document.getElementById('modal-add').hidden = true;
}

function handleAddCompanyConfirm() {
  const companyName = document.getElementById('modal-company-name').value.trim();
  const position = document.getElementById('modal-position').value.trim();
  if (!companyName) { showToast('请输入公司名称'); return; }
  if (!position) { showToast('请输入岗位名称'); return; }

  const result = addCompany({
    companyName,
    location: document.getElementById('modal-company-location').value.trim(),
    companyType: document.getElementById('modal-company-type').value,
    companyNote: document.getElementById('modal-company-note').value.trim(),
    position,
    salary: document.getElementById('modal-salary').value.trim(),
    channel: document.getElementById('modal-channel').value.trim(),
    applicationDate: document.getElementById('modal-application-date').value,
    status: document.getElementById('modal-status').value,
    positionNote: document.getElementById('modal-position-note').value.trim(),
  });

  state.selectedCompanyId = result.company.id;
  state.selectedPositionId = result.position.id;
  state.expandedIds.add(result.company.id);
  closeAddCompanyModal();
  renderCompanyList();
  renderDetail();
  showToast('已添加公司');
}

// ===== 添加岗位弹窗 =====
function openAddPositionModal() {
  if (!state.selectedCompanyId) return;
  const c = getCompany(state.selectedCompanyId);
  document.getElementById('modal-position-company').textContent = `— ${c.name}`;
  document.getElementById('mp-position').value = '';
  document.getElementById('mp-salary').value = '';
  document.getElementById('mp-channel').value = '';
  document.getElementById('mp-application-date').value = '';
  document.getElementById('mp-status').value = 'pending';
  document.getElementById('mp-position-note').value = '';
  document.getElementById('modal-add-position').hidden = false;
  setTimeout(() => document.getElementById('mp-position').focus(), 50);
}

function closeAddPositionModal() {
  document.getElementById('modal-add-position').hidden = true;
}

function handleAddPositionConfirm() {
  const position = document.getElementById('mp-position').value.trim();
  if (!position) { showToast('请输入岗位名称'); return; }

  const p = addPosition(state.selectedCompanyId, {
    position,
    salary: document.getElementById('mp-salary').value.trim(),
    channel: document.getElementById('mp-channel').value.trim(),
    applicationDate: document.getElementById('mp-application-date').value,
    status: document.getElementById('mp-status').value,
    positionNote: document.getElementById('mp-position-note').value.trim(),
  });

  state.selectedPositionId = p.id;
  closeAddPositionModal();
  renderCompanyList();
  renderDetail();
  showToast('已添加岗位');
}

// ===== 备份导出/导入 =====
function exportData() {
  const data = { companies: state.companies };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('备份已导出');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.companies || !Array.isArray(parsed.companies)) {
        showToast('文件格式不正确');
        return;
      }
      let companies = parsed.companies;
      if (companies.length > 0 && !companies[0].positions) {
        companies = migrateOldFormat(companies);
      }
      companies = normalizeCompanies(companies).companies;
      showConfirm(`将导入 ${companies.length} 家公司记录，是否覆盖当前数据？`, () => {
        state.companies = companies;
        state.selectedCompanyId = null;
        state.selectedPositionId = null;
        saveData();
        renderCompanyList();
        renderDetail();
        showToast('导入成功');
      });
    } catch (err) {
      showToast('文件解析失败，请确认是有效的 JSON');
    }
  };
  reader.readAsText(file);
}

// ===== 事件绑定 =====
function bindEvents() {
  document.getElementById('nav-records').addEventListener('click', () => setCurrentView('records'));
  document.getElementById('nav-stats').addEventListener('click', () => setCurrentView('stats'));
  document.getElementById('stats-range').querySelectorAll('.stats-range-btn').forEach(button => {
    button.addEventListener('click', () => {
      state.statsRange = button.dataset.range;
      document.getElementById('stats-range').querySelectorAll('.stats-range-btn').forEach(item => {
        item.className = `stats-range-btn ${item === button ? 'active' : ''}`.trim();
      });
      renderStats();
    });
  });

  document.getElementById('btn-add-company').addEventListener('click', openAddCompanyModal);
  document.getElementById('btn-job-image').addEventListener('click', () => {
    document.getElementById('file-job-image').click();
  });
  document.getElementById('btn-job-image-reselect').addEventListener('click', () => {
    document.getElementById('file-job-image').click();
  });
  document.getElementById('file-job-image').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleJobImageFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('modal-cancel').addEventListener('click', closeAddCompanyModal);
  document.getElementById('modal-add-confirm').addEventListener('click', handleAddCompanyConfirm);
  document.getElementById('modal-add').addEventListener('click', (e) => {
    if (e.target.id === 'modal-add') closeAddCompanyModal();
  });

  document.getElementById('btn-add-position').addEventListener('click', openAddPositionModal);
  document.getElementById('mp-cancel').addEventListener('click', closeAddPositionModal);
  document.getElementById('mp-confirm').addEventListener('click', handleAddPositionConfirm);
  document.getElementById('modal-add-position').addEventListener('click', (e) => {
    if (e.target.id === 'modal-add-position') closeAddPositionModal();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchKeyword = e.target.value;
    renderCompanyList();
  });

  document.getElementById('status-filter').addEventListener('change', (e) => {
    state.statusFilter = e.target.value;
    renderCompanyList();
  });

  document.getElementById('btn-save-company').addEventListener('click', () => {
    if (!state.selectedCompanyId) return;
    const name = document.getElementById('field-company-name').value.trim();
    if (!name) { showToast('公司名称不能为空'); return; }
    updateCompany(state.selectedCompanyId, {
      name,
      location: document.getElementById('field-company-location').value.trim(),
      companyType: document.getElementById('field-company-type').value,
      note: document.getElementById('field-company-note').value.trim(),
    });
    renderCompanyList();
    renderDetail();
    showToast('公司信息已保存');
  });

  document.getElementById('btn-delete-company').addEventListener('click', () => {
    if (!state.selectedCompanyId) return;
    const companyId = state.selectedCompanyId;
    const c = getCompany(companyId);
    showConfirm(`确定删除公司「${c.name}」及其所有岗位吗？此操作不可恢复。`, () => {
      deleteCompany(companyId);
      renderCompanyList();
      renderDetail();
      showToast('已删除');
    });
  });

  document.getElementById('btn-save-position').addEventListener('click', () => {
    if (!state.selectedCompanyId || !state.selectedPositionId) return;
    const position = document.getElementById('field-position').value.trim();
    if (!position) { showToast('岗位名称不能为空'); return; }
    updatePosition(state.selectedCompanyId, state.selectedPositionId, {
      position,
      salary: document.getElementById('field-salary').value.trim(),
      channel: document.getElementById('field-channel').value.trim(),
      applicationDate: document.getElementById('field-application-date').value,
      status: document.getElementById('field-status').value,
      note: document.getElementById('field-position-note').value.trim(),
    });
    renderCompanyList();
    renderDetail();
    showToast('岗位信息已保存');
  });

  document.getElementById('btn-delete-position').addEventListener('click', () => {
    if (!state.selectedCompanyId || !state.selectedPositionId) return;
    const companyId = state.selectedCompanyId;
    const positionId = state.selectedPositionId;
    const p = getCurrentPosition();
    const c = getCompany(companyId);
    if (c.positions.length <= 1) {
      showToast('至少保留一个岗位，如需删除请删除整个公司');
      return;
    }
    showConfirm(`确定删除岗位「${p.position}」吗？`, () => {
      deletePosition(companyId, positionId);
      renderCompanyList();
      renderDetail();
      showToast('已删除岗位');
    });
  });

  document.getElementById('btn-add-event').addEventListener('click', () => {
    if (!state.selectedCompanyId || !state.selectedPositionId) return;
    const date = document.getElementById('new-event-date').value;
    const event = document.getElementById('new-event-text').value.trim();
    const stage = document.getElementById('new-event-stage').value;
    const result = document.getElementById('new-event-result').value;
    if (!date) { showToast('请选择日期'); return; }
    if (stage === 'other' && !event) { showToast('请输入事件描述'); return; }
    addEvent(state.selectedCompanyId, state.selectedPositionId, date, event, stage, result);
    renderDetail();
    renderCompanyList();
    showToast('已添加进展');
  });

  document.getElementById('new-event-stage').addEventListener('change', updateEventResultVisibility);

  document.getElementById('new-event-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-event').click();
  });

  document.getElementById('btn-save-prep').addEventListener('click', () => {
    if (!state.selectedCompanyId || !state.selectedPositionId) return;
    updatePosition(state.selectedCompanyId, state.selectedPositionId, {
      interviewPrep: document.getElementById('field-interview-prep').value,
    });
    showToast('面试准备已保存');
  });

  document.getElementById('btn-save-summary').addEventListener('click', () => {
    if (!state.selectedCompanyId || !state.selectedPositionId) return;
    updatePosition(state.selectedCompanyId, state.selectedPositionId, {
      experienceSummary: document.getElementById('field-summary').value,
    });
    showToast('经验总结已保存');
  });

  document.getElementById('btn-save').addEventListener('click', exportData);

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.getElementById('confirm-cancel').addEventListener('click', hideConfirm);
  document.getElementById('confirm-ok').addEventListener('click', () => {
    const callback = confirmCallback;
    hideConfirm();
    if (callback) callback();
  });
  document.getElementById('modal-confirm').addEventListener('click', (e) => {
    if (e.target.id === 'modal-confirm') hideConfirm();
  });
}

// ===== 初始化 =====
function init() {
  loadData();
  bindEvents();
  updateSaveButton();
  renderCompanyList();
  renderDetail();
}

document.addEventListener('DOMContentLoaded', init);
