const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const bundledData = JSON.parse(
  dataSource.slice(dataSource.indexOf('{'), dataSource.lastIndexOf('}') + 1)
);

function assertUniqueHtmlIds() {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], `重复的 HTML ID: ${duplicates.join(', ')}`);
  const referencedIds = [...appSource.matchAll(/getElementById\('([^']+)'\)/g)]
    .map(match => match[1]);
  const missingIds = [...new Set(referencedIds.filter(id => !ids.includes(id)))];
  assert.deepEqual(missingIds, [], `JavaScript 引用了不存在的 ID: ${missingIds.join(', ')}`);
  assert.ok(ids.includes('modal-add-confirm'));
  assert.ok(ids.includes('modal-confirm'));
  assert.ok(ids.includes('confirm-ok'));
}

function createApp() {
  const values = new Map();
  const exportSource = `
    globalThis.__appTest = {
      state,
      loadData,
      addCompany,
      updateCompany,
      deleteCompany,
      addPosition,
      updatePosition,
      deletePosition,
      addEvent,
      deleteEvent,
      todayStr,
      getApplicationDate,
      calculateStatistics,
    };
  `;
  const button = {};
  const context = {
    console,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, value),
    },
    document: {
      addEventListener: () => {},
      getElementById: id => id === 'btn-save' ? button : {},
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${dataSource}\n${appSource}\n${exportSource}`, context);
  return { api: context.__appTest, values };
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.hidden = false;
    this.dataset = {};
    this.files = [];
    this.listeners = {};
    this.attributes = {};
    this.queryResults = {};
    this.style = {};
    this._innerHTML = '';
    this._textContent = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = this._textContent
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  get textContent() {
    return this._textContent;
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  click() {
    this.clicked = true;
    this.dispatch('click');
  }

  dispatch(type, extra = {}) {
    const event = { target: this, stopPropagation: () => {}, ...extra };
    for (const listener of this.listeners[type] || []) listener(event);
  }

  querySelectorAll(selector) {
    return this.queryResults[selector] || [];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild() {}
  removeChild() {}
  focus() {}
}

function createUiApp(fetchImpl = async () => { throw new TypeError('fetch unavailable'); }) {
  const values = new Map();
  const elements = new Map();
  const createdElements = [];
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };

  for (const id of ['modal-add', 'modal-add-position', 'modal-confirm', 'detail-content',
    'position-detail', 'section-summary', 'toast', 'stats-page']) {
    getElement(id).hidden = true;
  }
  const rangeButtons = ['7', '30', '90', 'all'].map(range => {
    const button = new MockElement(`range-${range}`);
    button.dataset.range = range;
    button.className = `stats-range-btn ${range === '30' ? 'active' : ''}`.trim();
    return button;
  });
  getElement('stats-range').queryResults['.stats-range-btn'] = rangeButtons;

  const document = {
    body: new MockElement('body'),
    addEventListener: () => {},
    getElementById: getElement,
    createElement: () => {
      const element = new MockElement();
      createdElements.push(element);
      return element;
    },
  };
  class MockFileReader {
    readAsText(file) {
      this.onload({ target: { result: file.contents } });
    }

    readAsDataURL(file) {
      this.onload({ target: { result: file.dataUrl } });
    }
  }
  const context = {
    console,
    document,
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, value),
    },
    setTimeout: callback => { callback(); return 1; },
    clearTimeout: () => {},
    Blob,
    FileReader: MockFileReader,
    AbortController,
    fetch: fetchImpl,
    URL: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {},
    },
  };
  context.window = context;
  context.DEFAULT_JOB_DATA = { companies: [] };
  vm.createContext(context);
  vm.runInContext(`${appSource}\n;globalThis.__uiTest = {
    state,
    init,
    handleJobImageFile,
    normalizeJobExtractionData,
  };`, context);
  context.__uiTest.init();
  return { api: context.__uiTest, getElement, values, createdElements };
}

function runWorkflowTest() {
  const { api, values } = createApp();

  api.loadData();
  assert.equal(
    api.state.companies.length,
    bundledData.companies.length,
    '首次打开应加载内置数据'
  );
  assert.equal(api.todayStr({
    getFullYear: () => 2026,
    getMonth: () => 8,
    getDate: () => 4,
  }), '2026-09-04', '日期应使用本地年月日');

  api.state.companies.splice(0);
  const created = api.addCompany({
    companyName: '流程测试公司',
    location: '杭州',
    companyType: 'private',
    companyNote: '测试备注',
    position: '前端工程师',
    salary: '20-30K',
    channel: '官网',
    applicationDate: '2026-09-30',
    status: 'applied',
    positionNote: '岗位备注',
  });
  assert.equal(api.state.companies.length, 1);
  assert.equal(created.company.companyType, 'private');
  assert.equal(created.position.applicationDate, '2026-09-30');
  assert.equal(created.position.timeline[0].date, '2026-09-30');
  assert.equal(created.position.timeline[0].event, '投递简历');
  assert.equal(created.position.timeline[0].stage, 'application');
  assert.equal(created.position.timeline[0].result, '');

  api.updateCompany(created.company.id, { name: '已编辑公司' });
  assert.equal(created.company.name, '已编辑公司');

  api.updatePosition(created.company.id, created.position.id, {
    position: '高级前端工程师',
    status: 'interviewing',
  });
  assert.equal(created.position.position, '高级前端工程师');

  const secondPosition = api.addPosition(created.company.id, {
    position: '全栈工程师',
    status: 'pending',
  });
  assert.equal(created.company.positions.length, 2);

  api.addEvent(created.company.id, secondPosition.id, '2026-09-08', '一面');
  assert.equal(secondPosition.timeline.length, 1);
  api.deleteEvent(created.company.id, secondPosition.id, secondPosition.timeline[0].id);
  assert.equal(secondPosition.timeline.length, 0);

  api.state.selectedPositionId = secondPosition.id;
  api.deletePosition(created.company.id, secondPosition.id);
  assert.equal(created.company.positions.length, 1);
  assert.equal(api.state.selectedPositionId, created.position.id);

  api.state.selectedCompanyId = created.company.id;
  api.deleteCompany(created.company.id);
  assert.equal(api.state.companies.length, 0);
  assert.equal(api.state.selectedCompanyId, null);

  const saved = JSON.parse(values.get('job_tracker_data'));
  assert.deepEqual(saved.companies, []);
}

function runLegacyDataMigrationTest() {
  const { api, values } = createApp();
  values.set('job_tracker_data', JSON.stringify({
    companies: [{
      id: 'legacy-company',
      name: '旧数据公司',
      location: '',
      positions: [{
        id: 'legacy-position',
        position: '旧岗位',
        deadline: '2026-08-31',
        status: 'applied',
        timeline: [
          { id: 'legacy-application', date: '2026-08-31', event: '投递简历' },
          { id: 'legacy-note', date: '2026-09-01', event: '初试通过，等待通知' },
        ],
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      }],
    }],
  }));

  api.loadData();
  const company = api.state.companies[0];
  const position = company.positions[0];
  assert.equal(company.companyType, '', '旧公司数据应默认为未分类');
  assert.equal(position.applicationDate, '2026-08-31', '旧截止日期应迁移为投递日期');
  assert.equal(Object.hasOwn(position, 'deadline'), false, '迁移后不应保留旧字段');
  assert.equal(position.timeline[0].stage, 'application', '标准旧事件应补充结构化类型');
  assert.equal(position.timeline[0].result, '');
  assert.equal(position.timeline[1].stage, 'other', '自由文本不应被模糊推断');

  const saved = JSON.parse(values.get('job_tracker_data'));
  assert.equal(saved.companies[0].positions[0].applicationDate, '2026-08-31');
}

function runUiEventTest() {
  const { api, getElement, createdElements } = createUiApp();

  getElement('btn-add-company').click();
  assert.equal(getElement('modal-add').hidden, false, '添加公司弹窗应打开');
  assert.equal(getElement('modal-add-confirm').hidden, false, '添加按钮应可见');

  getElement('modal-add-confirm').click();
  assert.equal(api.state.companies.length, 0, '缺少必填项时不能创建公司');
  assert.equal(getElement('toast').textContent, '请输入公司名称');

  getElement('modal-company-name').value = '界面测试公司';
  getElement('modal-add-confirm').click();
  assert.equal(api.state.companies.length, 0, '缺少岗位名称时不能创建公司');
  assert.equal(getElement('toast').textContent, '请输入岗位名称');

  getElement('modal-position').value = '测试岗位';
  getElement('modal-company-type').value = 'state';
  getElement('modal-application-date').value = '2026-09-05';
  getElement('modal-status').value = 'applied';
  getElement('modal-add-confirm').click();
  assert.equal(api.state.companies.length, 1, '点击添加应创建公司');
  assert.equal(api.state.companies[0].companyType, 'state');
  assert.equal(api.state.companies[0].positions[0].applicationDate, '2026-09-05');
  assert.equal(getElement('modal-add').hidden, true, '添加后弹窗应关闭');
  assert.equal(getElement('modal-add-confirm').hidden, false, '添加按钮不能被确认弹窗逻辑隐藏');

  getElement('field-company-name').value = '已编辑界面测试公司';
  getElement('field-company-location').value = '上海';
  getElement('field-company-type').value = 'private';
  getElement('field-company-note').value = '已保存备注';
  getElement('btn-save-company').click();
  assert.equal(api.state.companies[0].name, '已编辑界面测试公司');
  assert.equal(api.state.companies[0].location, '上海');
  assert.equal(api.state.companies[0].companyType, 'private');

  getElement('btn-add-position').click();
  getElement('mp-confirm').click();
  assert.equal(api.state.companies[0].positions.length, 1, '缺少岗位名称时不能添加岗位');
  assert.equal(getElement('toast').textContent, '请输入岗位名称');
  getElement('mp-position').value = '第二岗位';
  getElement('mp-application-date').value = '2026-09-06';
  getElement('mp-confirm').click();
  assert.equal(api.state.companies[0].positions.length, 2, '应能添加第二个岗位');
  assert.equal(api.state.companies[0].positions[1].applicationDate, '2026-09-06');

  getElement('field-position').value = '';
  getElement('btn-save-position').click();
  assert.equal(api.state.companies[0].positions[1].position, '第二岗位', '空岗位名称不能覆盖原值');
  assert.equal(getElement('toast').textContent, '岗位名称不能为空');

  getElement('field-position').value = '已编辑岗位';
  getElement('field-application-date').value = '2026-09-07';
  getElement('field-status').value = 'offer';
  getElement('btn-save-position').click();
  assert.equal(api.state.companies[0].positions[1].position, '已编辑岗位');
  assert.equal(api.state.companies[0].positions[1].applicationDate, '2026-09-07');
  assert.equal(getElement('section-summary').hidden, false, '结束状态应显示经验总结');

  getElement('field-interview-prep').value = '准备内容';
  getElement('btn-save-prep').click();
  assert.equal(api.state.companies[0].positions[1].interviewPrep, '准备内容');
  getElement('field-summary').value = '总结内容';
  getElement('btn-save-summary').click();
  assert.equal(api.state.companies[0].positions[1].experienceSummary, '总结内容');

  getElement('new-event-date').value = '2026-09-10';
  getElement('new-event-stage').value = 'firstInterview';
  getElement('new-event-stage').dispatch('change');
  assert.equal(getElement('new-event-result-group').hidden, false, '面试阶段应显示结果选择');
  getElement('new-event-result').value = 'passed';
  getElement('new-event-text').value = '';
  getElement('btn-add-event').click();
  assert.equal(api.state.companies[0].positions[1].timeline.length, 1, '应能添加进展');
  assert.equal(api.state.companies[0].positions[1].timeline[0].stage, 'firstInterview');
  assert.equal(api.state.companies[0].positions[1].timeline[0].result, 'passed');
  assert.equal(api.state.companies[0].positions[1].timeline[0].event, '初试');

  getElement('nav-stats').click();
  assert.equal(api.state.currentView, 'stats');
  assert.equal(getElement('records-page').hidden, true, '统计页打开时应隐藏记录页');
  assert.equal(getElement('records-page').style.display, 'none', '记录页应强制隐藏，避免本地浏览器覆盖 hidden 样式');
  assert.equal(getElement('stats-page').hidden, false, '统计页应显示');
  assert.equal(getElement('stats-page').style.display, 'block');
  assert.match(getElement('stats-content').innerHTML, /每日投递/);
  getElement('stats-range').queryResults['.stats-range-btn'][0].click();
  assert.equal(api.state.statsRange, '7', '应能切换统计范围');
  getElement('nav-records').click();
  assert.equal(getElement('records-page').hidden, false, '返回记录页后应恢复原界面');
  assert.equal(getElement('records-page').style.display, '');

  getElement('btn-delete-position').click();
  assert.equal(getElement('modal-confirm').hidden, false, '删除岗位应显示确认弹窗');
  getElement('confirm-cancel').click();
  assert.equal(api.state.companies[0].positions.length, 2, '取消后不能删除岗位');

  getElement('btn-delete-position').click();
  getElement('confirm-ok').click();
  assert.equal(api.state.companies[0].positions.length, 1, '确认后应删除岗位');
  assert.equal(getElement('modal-confirm').hidden, true, '确认后弹窗应关闭');

  getElement('btn-delete-position').click();
  assert.equal(api.state.companies[0].positions.length, 1, '最后一个岗位不能单独删除');
  assert.equal(getElement('toast').textContent, '至少保留一个岗位，如需删除请删除整个公司');

  getElement('search-input').value = '界面测试';
  getElement('search-input').dispatch('input');
  assert.equal(api.state.searchKeyword, '界面测试');
  getElement('status-filter').value = 'applied';
  getElement('status-filter').dispatch('change');
  assert.equal(api.state.statusFilter, 'applied');

  getElement('btn-delete-company').click();
  assert.equal(getElement('modal-confirm').hidden, false, '删除公司应显示确认弹窗');
  getElement('confirm-cancel').click();
  assert.equal(api.state.companies.length, 1, '取消后不能删除公司');
  getElement('btn-delete-company').click();
  getElement('confirm-ok').click();
  assert.equal(api.state.companies.length, 0, '确认后应删除公司');

  const imported = {
    companies: [{
      id: 'imported-company',
      name: '导入公司',
      location: '',
      note: '',
      createdAt: '2026-09-04',
      positions: [],
    }],
  };
  getElement('file-import').files = [{ contents: JSON.stringify(imported) }];
  getElement('file-import').dispatch('change');
  assert.equal(getElement('modal-confirm').hidden, false, '导入前应显示覆盖确认');
  getElement('confirm-ok').click();
  assert.equal(api.state.companies[0].id, 'imported-company', '确认后应导入备份');

  getElement('btn-save').click();
  const anchor = createdElements.at(-1);
  assert.equal(anchor.download, 'data.json');
  assert.equal(anchor.clicked, true, '导出按钮应触发文件下载');
  assert.equal(getElement('toast').textContent, '备份已导出');
}

function runStatisticsTest() {
  const { api } = createApp();
  const companies = [
    {
      id: 'state-company',
      companyType: 'state',
      positions: [
        {
          id: 'p1', status: 'applied', applicationDate: '2026-09-13', channel: '官网',
          timeline: [
            { date: '2026-09-11', stage: 'application', result: '', event: '重复投递事件' },
            { date: '2026-09-12', stage: 'firstInterview', result: 'passed', event: '初试' },
          ],
        },
        {
          id: 'p2', status: 'interviewing', applicationDate: '', channel: '',
          timeline: [
            { date: '2026-09-12', stage: 'application', result: '', event: '投递简历' },
            { date: '2026-09-13', stage: 'firstInterview', result: 'pending', event: '初试' },
            { date: '2026-09-13', stage: 'firstInterview', result: 'failed', event: '初试' },
          ],
        },
      ],
    },
    {
      id: 'private-company',
      companyType: 'private',
      positions: [{
        id: 'p3', status: 'offer', applicationDate: '2026-08-01', channel: '内推',
        timeline: [
          { date: '2026-08-02', stage: 'firstInterview', result: 'passed', event: '初试' },
          { date: '2026-08-15', stage: 'offer', result: '', event: 'Offer' },
        ],
      }],
    },
    {
      id: 'unknown-company',
      companyType: '',
      positions: [
        { id: 'p4', status: 'pending', applicationDate: '', channel: '', timeline: [] },
        { id: 'p5', status: 'applied', applicationDate: '', channel: '猎头', timeline: [] },
      ],
    },
  ];
  const referenceDate = new Date(2026, 8, 13);
  const recent = api.calculateStatistics(companies, '7', referenceDate);

  assert.equal(recent.applicationCount, 2, '近七天应只统计范围内投递岗位');
  assert.equal(recent.daily.find(item => item.date === '2026-09-13').count, 1, '同一岗位不得重复计数');
  assert.equal(recent.daily.find(item => item.date === '2026-09-12').count, 1, '缺失日期时应回退投递事件');
  assert.equal(recent.firstInterviewPassRate, 50, '待进行结果不应进入初试通过率分母');
  assert.equal(recent.completedFirstInterviews, 2);
  assert.equal(recent.funnel.applied, 2);
  assert.equal(recent.funnel.firstInterview, 2);
  assert.equal(recent.funnel.firstPassed, 1);
  assert.equal(recent.offerCount, 1, '当前 Offer 数不受时间范围影响');
  assert.equal(recent.companyTypes.state, 1);
  assert.equal(recent.companyTypes.private, 1);
  assert.equal(recent.companyTypes.unclassified, 1);
  assert.equal(recent.channels.find(item => item.name === '未填写').count, 1);
  assert.equal(recent.undatedAppliedCount, 1);

  const all = api.calculateStatistics(companies, 'all', referenceDate);
  assert.equal(all.applicationCount, 4, '全部范围应包含无日期但状态为已投递的岗位');
  assert.equal(all.daily.reduce((sum, item) => sum + item.count, 0), 3, '无日期投递无法进入每日趋势');
  assert.equal(all.funnel.offer, 1, '漏斗 Offer 应属于已记录初试通过的子集');

  const empty = api.calculateStatistics([], '30', referenceDate);
  assert.equal(empty.applicationCount, 0);
  assert.equal(empty.firstInterviewPassRate, null, '无样本时不应显示 0%');
  assert.equal(empty.daily.length, 30);
}

async function runJobImageImportTest() {
  let fetchCount = 0;
  const responseData = {
    isJobPosting: true,
    company: {
      name: '截图识别公司',
      location: '杭州',
      companyType: 'private',
      note: '公司备注',
    },
    position: {
      name: '前端工程师',
      salary: '20-30K',
      channel: 'BOSS直聘',
      applicationDate: '2026-09-13',
      status: 'applied',
      note: '【岗位职责】\n负责前端开发',
    },
    warnings: ['薪资单位请确认'],
  };
  const { api, getElement } = createUiApp(async (url, options) => {
    fetchCount += 1;
    assert.equal(url, '/api/job-extract');
    assert.equal(options.method, 'POST');
    assert.match(JSON.parse(options.body).image, /^data:image\/png;base64,/);
    return {
      ok: true,
      json: async () => ({ ok: true, data: responseData }),
    };
  });

  getElement('btn-add-company').click();
  await api.handleJobImageFile({
    name: 'job.png',
    type: 'image/png',
    size: 1024,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.equal(fetchCount, 1);
  assert.equal(getElement('modal-company-name').value, '截图识别公司');
  assert.equal(getElement('modal-company-location').value, '杭州');
  assert.equal(getElement('modal-position').value, '前端工程师');
  assert.equal(getElement('modal-salary').value, '20-30K');
  assert.equal(getElement('modal-channel').value, 'BOSS直聘');
  assert.equal(getElement('modal-application-date').value, '', '识别不能填写投递日期');
  assert.equal(getElement('modal-status').value, 'pending', '识别不能改变默认投递状态');
  assert.equal(api.state.companies.length, 0, '识别结果只能预填，不能自动保存');
  assert.match(getElement('job-image-status').textContent, /识别完成/);

  await api.handleJobImageFile({
    name: 'job.gif',
    type: 'image/gif',
    size: 100,
    dataUrl: 'data:image/gif;base64,R0lGODlh',
  });
  assert.equal(fetchCount, 1, '非法图片不能调用识别接口');
  assert.match(getElement('job-image-status').textContent, /仅支持/);

  assert.throws(() => api.normalizeJobExtractionData({ isJobPosting: false }), /不像招聘信息/);
  assert.throws(() => api.normalizeJobExtractionData({ isJobPosting: true }), /缺少公司或岗位信息/);
}

async function main() {
  assertUniqueHtmlIds();
  runWorkflowTest();
  runLegacyDataMigrationTest();
  runUiEventTest();
  runStatisticsTest();
  await runJobImageImportTest();
  console.log('All workflow tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
