(function () {
  const DATA = window.LECTURE_ENTITY_DATA || window.DATA;
  if (!DATA || !Array.isArray(DATA.entities)) {
    console.error('Missing lecture explorer data');
    return;
  }

  const entities = DATA.entities;
  const $ = id => document.getElementById(id);
  const controls = [
    'search', 'entityType', 'typeLabel', 'category', 'gram', 'oxygen', 'pathogenicity',
    'source', 'speciesFocus', 'system', 'transmission', 'zoonoticStatus', 'reportingStatus',
    'route', 'mechanismGroup', 'cautionTag', 'diseaseClass', 'sortBy', 'viewMode',
    'treeRoot', 'iloOnly', 'contraOnly', 'zoonoticOnly', 'reportableOnly', 'drugOnly',
    'pathogenOnly', 'diseaseOnly', 'testType', 'testScope'
  ].reduce((acc, id) => {
    acc[id] = $(id);
    return acc;
  }, {});
  const panels = {
    cards: $('cardsPanel'),
    tree: $('treePanel'),
    test: $('testPanel')
  };

  let treeScale = 1;
  let treePan = null;
  let selectedTreeNode = '';
  let treeFullscreen = false;
  const testState = { mode: '', item: null, clues: [], step: 0, path: [], pathIndex: 0, pool: [], options: [], answered: false };

  const esc = s => String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const uniq = key => [...new Set(entities.map(e => e[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const uniqList = key => [...new Set(entities.flatMap(e => Array.isArray(e[key]) ? e[key] : e[key] ? [e[key]] : []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const fill = (el, label, values) => {
    el.innerHTML = `<option value="">All ${label}</option>` + values.map(v => `<option>${esc(v)}</option>`).join('');
  };

  function titleCase(text) {
    return String(text || '').split(/[\s/-]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  function normalized(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i ? (j ? 0 : i) : j));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  }

  function fuzzyEquals(input, target) {
    const a = normalized(input);
    const b = normalized(target);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length < 3) return false;
    const d = levenshtein(a, b);
    return d <= Math.max(1, Math.floor(b.length * 0.18));
  }

  function hostValues(item) {
    return Array.isArray(item.hosts) && item.hosts.length ? item.hosts : (item.speciesFocus || []);
  }

  function typeParts(item) {
    const parts = String(item.typeLabel || '').split('/').map(part => part.trim()).filter(Boolean);
    let primary = parts[0] || item.typeLabel || item.category || 'Unspecified';
    let secondary = parts[1] || '';
    if (item.entityType === 'drug' && /^anaesthetic$/i.test(primary) && Array.isArray(item.routes) && item.routes.includes('injectable')) {
      const lowerSecondary = normalized(secondary);
      if (lowerSecondary && lowerSecondary !== 'local anaesthetic' && lowerSecondary !== 'inhalational') {
        secondary = 'injectable anaesthetic';
      }
    }
    return {
      primary,
      secondary
    };
  }

  function drugDomain(item) {
    const type = String(item.typeLabel || '').toLowerCase();
    const category = String(item.category || '').toLowerCase();
    if (type.includes('antibacterial') || type.includes('antiparasitic') || type.includes('macrocyclic lactone') || category.includes('antibacterial') || category.includes('antiparasitic') || category.includes('ectoparasiticide')) return 'Antipathogenic';
    if (type.includes('anaesthetic') || type.includes('sedative') || type.includes('reversal') || category.includes('anaesthetic') || category.includes('sedative') || category.includes('local anaesthetic')) return 'Anaesthesia and sedation';
    if (type.includes('analgesic') || type.includes('anti-inflammatory') || type.includes('glucocorticoid') || category.includes('analgesic') || category.includes('glucocorticoid')) return 'Analgesia and anti-inflammatory';
    if (type.includes('hormone') || type.includes('endocrine') || category.includes('endocrine')) return 'Endocrine and hormonal';
    if (type.includes('renal') || type.includes('cardiovascular') || category.includes('renal/cardiovascular') || category.includes('cardiovascular')) return 'Cardiovascular and renal';
    if (type.includes('antiemetic') || category.includes('antiemetic')) return 'Supportive care';
    if (type.includes('euthanasia') || category.includes('euthanasia')) return 'Euthanasia';
    return 'Other drugs';
  }

  function drugActionTags(item) {
    const tags = new Set();
    const type = String(item.typeLabel || '').toLowerCase();
    const category = String(item.category || '').toLowerCase();
    const uses = (item.uses || []).join(' ');
    if (type.includes('analgesic') || category.includes('analgesic') || /(pain|analgesi)/i.test(uses)) tags.add('analgesic');
    if (type.includes('anti-inflammatory') || type.includes('nsaid') || category.includes('glucocorticoid') || /(anti-inflammatory|osteoarthritis)/i.test(uses)) tags.add('anti-inflammatory');
    if (type.includes('sedative') || /(sedation|premedication)/i.test(uses)) tags.add('sedative');
    if (type.includes('anaesthetic') || /(induction|maintenance|tiva|local)/i.test(uses)) tags.add('anaesthetic');
    if (type.includes('antibacterial') || category.includes('antibacterial')) tags.add('antibacterial');
    if (type.includes('antiparasitic') || category.includes('antiparasitic') || category.includes('ectoparasiticide')) tags.add('antiparasitic');
    if (type.includes('antiemetic') || category.includes('antiemetic')) tags.add('antiemetic');
    if (type.includes('hormone') || type.includes('endocrine') || category.includes('endocrine')) tags.add('endocrine');
    return [...tags];
  }

  function groupValue(item, key) {
    if (key === 'entityType') return titleCase(item.entityType);
    if (key === 'inIlo') return item.inIlo ? 'Mentioned in ILO' : 'Not in ILO';
    if (key === 'sourceBucket') {
      if ((item.sourceCount || 0) >= 10) return '10+ source mentions';
      if ((item.sourceCount || 0) >= 5) return '5-9 source mentions';
      if ((item.sourceCount || 0) >= 2) return '2-4 source mentions';
      return '1 source mention';
    }
    if (key === 'domainBranch') {
      if (item.entityType === 'drug') return drugDomain(item);
      if (item.entityType === 'pathogen') return titleCase(item.typeLabel || item.category || 'Pathogen');
      return titleCase(item.category || (item.systems || [])[0] || 'Disease');
    }
    if (key === 'typePrimary') {
      if (item.entityType === 'drug') return typeParts(item).primary;
      if (item.entityType === 'pathogen') return item.subtype || item.category || item.typeLabel || 'Specific entries';
      return item.diseaseClass || item.subtype || 'Specific entries';
    }
    if (key === 'typeSecondary') {
      if (item.entityType === 'drug') return typeParts(item).secondary || (item.category === 'drug class' ? '' : 'Specific entries');
      if (item.entityType === 'pathogen') return item.gram || item.oxygen || 'Specific entries';
      return 'Specific entries';
    }
    if (key === 'systemBucket') return (item.systems && item.systems[0]) || 'Unspecified';
    if (key === 'hostBucket') return hostValues(item)[0] || 'Unspecified';
    if (key === 'routeBucket') return (item.routes && item.routes[0]) || 'Unspecified';
    if (key === 'mechanismBucket') return item.mechanismGroup || 'Unspecified';
    if (key === 'cautionBucket') return (item.cautionTags && item.cautionTags[0]) || 'Unspecified';
    if (key === 'diseaseClassBucket') return item.diseaseClass || 'Unspecified';
    return item[key] || 'Unspecified';
  }

  const treeFields = [
    { value: 'entityType', label: 'Entity type' },
    { value: 'domainBranch', label: 'Domain branch' },
    { value: 'typeLabel', label: 'Specific type' },
    { value: 'typePrimary', label: 'Type family' },
    { value: 'typeSecondary', label: 'Type detail' },
    { value: 'category', label: 'Category' },
    { value: 'subtype', label: 'Subtype' },
    { value: 'gram', label: 'Gram stain' },
    { value: 'oxygen', label: 'Oxygen preference' },
    { value: 'pathogenicity', label: 'Pathogenicity' },
    { value: 'zoonoticStatus', label: 'Zoonotic status' },
    { value: 'reportingStatus', label: 'Reporting status' },
    { value: 'systemBucket', label: 'Body system' },
    { value: 'hostBucket', label: 'Host / species' },
    { value: 'routeBucket', label: 'Route' },
    { value: 'mechanismBucket', label: 'Mechanism' },
    { value: 'cautionBucket', label: 'Caution tag' },
    { value: 'diseaseClassBucket', label: 'Disease class' },
    { value: 'inIlo', label: 'ILO presence' },
    { value: 'sourceBucket', label: 'Mention count band' }
  ];

  function autoLevels(root) {
    const map = {
      entityType: ['domainBranch', 'typePrimary', 'typeSecondary'],
      domainBranch: ['typePrimary', 'typeSecondary'],
      typeLabel: ['domainBranch', 'typePrimary', 'typeSecondary'],
      typePrimary: ['typeSecondary'],
      typeSecondary: [],
      category: ['typeSecondary', 'entityType'],
      subtype: ['typePrimary'],
      gram: ['oxygen'],
      oxygen: ['gram'],
      pathogenicity: ['entityType'],
      zoonoticStatus: ['reportingStatus'],
      reportingStatus: ['zoonoticStatus'],
      systemBucket: ['entityType'],
      hostBucket: ['entityType'],
      routeBucket: ['entityType'],
      mechanismBucket: ['entityType'],
      cautionBucket: ['entityType'],
      diseaseClassBucket: ['entityType'],
      inIlo: ['entityType'],
      sourceBucket: ['entityType']
    };
    return [root, ...(map[root] || ['typeLabel'])];
  }

  function section(title, values) {
    return values && values.length ? `<section><h4>${title}</h4><ul>${values.map(v => `<li>${esc(v)}</li>`).join('')}</ul></section>` : '';
  }

  function textSection(title, value) {
    return value ? `<section><h4>${title}</h4><div>${esc(value)}</div></section>` : '';
  }

  function renderIloLinks(item) {
    if (!item.iloLinks || !item.iloLinks.length) return '';
    return `<section><h4>Relevant ILO tests</h4><div class="ilo-list">${item.iloLinks.map(link => `
      <a class="ilo-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">
        <div class="ilo-title">${esc(link.ilo)}</div>
        <div class="muted">${esc(link.block)} | ${esc(link.week)} | ${esc(link.contentType)}</div>
        <div>${esc(link.title)}</div>
      </a>`).join('')}</div></section>`;
  }

  function renderEntityCard(item) {
    const chips = [
      item.typeLabel, item.category, item.subtype, item.gram, item.oxygen, item.pathogenicity,
      item.zoonoticStatus, item.reportingStatus, ...drugActionTags(item)
    ].filter(Boolean);
    const pathText = treePath(item).join(' -> ');
    return `
      <article class="card">
        <h3>${esc(item.name)}</h3>
        <div class="meta">${chips.map((v, i) => `<span class="chip ${i % 2 ? 'alt' : ''}">${esc(v)}</span>`).join('')}</div>
        ${pathText ? `<section><h4>Systems / tree path</h4><div class="tree-path">${esc(pathText)}</div></section>` : ''}
        ${section('Host / species', hostValues(item))}
        ${section('Body systems', item.systems)}
        ${section('Transmission', item.transmission)}
        ${section('Routes', item.routes)}
        ${textSection('Mechanism / main action', item.mechanism)}
        ${section('Commonly used in / for', item.commonUse)}
        ${section('Species or situations to avoid / use carefully in', item.avoidUse)}
        ${section('Possible alternatives or different plans', item.alternatives)}
        ${textSection('Why choose this over related options?', item.whyChoose)}
        ${section('Additional actions', drugActionTags(item))}
        ${section('Caution tags', item.cautionTags)}
        ${section('Disease links', item.diseaseLinks)}
        ${section('Clinical clues', item.clinicalSigns)}
        ${section('Uses', item.uses)}
        ${section('Contraindications / cautions', item.contraindications)}
        ${textSection('Public health / reporting', item.publicHealthNotes)}
        ${section('Zoonosis source mentions', item.zoonosisSourceMentions)}
        ${section('Reporting source mentions', item.reportingSourceMentions)}
        ${textSection('Disease class', item.diseaseClass)}
        ${section('Causative pathogens', item.causativePathogens)}
        ${section('Pathogenesis', item.pathogenesis)}
        ${section('Management drugs / treatment options', item.managementDrugs)}
        ${section('Management approach', item.managementPlan)}
        ${item.notes ? `<section><h4>Notes</h4><div>${esc(item.notes)}</div></section>` : ''}
        ${renderIloLinks(item)}
        <section><h4>Source mentions</h4><div class="sources">${(item.sourceMentions || []).map(esc).join(' | ') || 'No direct source mention stored for this support entity.'}</div></section>
      </article>`;
  }

  function branchInfo(label, field, items) {
    const examples = [...new Set(items.map(item => item.name))].sort((a, b) => a.localeCompare(b)).slice(0, 12);
    const systems = [...new Set(items.flatMap(item => item.systems || []).filter(Boolean))];
    const hosts = [...new Set(items.flatMap(item => hostValues(item)).filter(Boolean))];
    return `
      <article class="card tree-inline-card">
        <h3>${esc(label)}</h3>
        <div class="meta"><span class="chip">${esc(treeFields.find(entry => entry.value === field)?.label || field)}</span><span class="chip alt">${items.length} entries</span></div>
        ${systems.length ? `<section><h4>Body systems</h4><ul>${systems.map(v => `<li>${esc(v)}</li>`).join('')}</ul></section>` : ''}
        ${hosts.length ? `<section><h4>Hosts / species</h4><ul>${hosts.slice(0, 12).map(v => `<li>${esc(v)}</li>`).join('')}</ul></section>` : ''}
        <section><h4>Examples</h4><ul>${examples.map(name => `<li>${esc(name)}</li>`).join('')}</ul></section>
      </article>`;
  }

  function renderTreeNode(id, label, count) {
    const active = selectedTreeNode === id ? ' active' : '';
    const countHtml = typeof count === 'number' ? `<span class="count">(${count})</span>` : '';
    return `<button class="tree-node${active}" type="button" data-node="${esc(id)}">${esc(label)}${countHtml}</button>`;
  }

  function inlineDetailForNode(list, nodeId, field = '', label = '', branchItems = []) {
    if (!selectedTreeNode || selectedTreeNode !== nodeId) return '';
    if (nodeId.startsWith('item:')) {
      const name = nodeId.slice(5);
      const item = list.find(entry => entry.name === name);
      return item ? renderEntityCard(item).replace('<article class="card">', '<article class="card tree-inline-card">') : '';
    }
    if (nodeId === 'root') {
      return `
        <article class="card tree-inline-card">
          <h3>Filtered set</h3>
          <div class="meta"><span class="chip">Current tree</span><span class="chip alt">${list.length} entries</span></div>
          <section><h4>Summary</h4><div>Click any branch or item in the tree to open its details inline.</div></section>
        </article>`;
    }
    return branchInfo(label, field, branchItems);
  }

  function nodeLiClass(nodeId) {
    return selectedTreeNode === nodeId ? ' class="has-inline-detail"' : '';
  }

  function buildTree(items, levels, path = 'root', list = items) {
    if (!levels.length) {
      return `<ul class="tree-level">${items.map(item => {
        const nodeId = `item:${item.name}`;
        return `<li${nodeLiClass(nodeId)}>${renderTreeNode(nodeId, item.name)}${inlineDetailForNode(list, nodeId)}</li>`;
      }).join('')}</ul>`;
    }
    const [level, ...rest] = levels;
    const groups = new Map();
    items.forEach(item => {
      const key = groupValue(item, level);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const entries = [...groups.entries()].filter(([label]) => label && label !== 'Unspecified').sort((a, b) => a[0].localeCompare(b[0]));
    return `<ul class="tree-level">${entries.map(([label, grouped]) => {
      if ((label === 'Specific entries' || label === 'Items') && grouped.length) {
        return `<li>${rest.length ? buildTree(grouped, rest, `${path}-items`, list) : `<ul class="tree-level">${grouped.map(item => {
          const nodeId = `item:${item.name}`;
          return `<li${nodeLiClass(nodeId)}>${renderTreeNode(nodeId, item.name)}${inlineDetailForNode(list, nodeId)}</li>`;
        }).join('')}</ul>`}</li>`;
      }
      if (grouped.length === 1 && normalized(label) === normalized(grouped[0].name)) {
        const nodeId = `item:${grouped[0].name}`;
        return `<li${nodeLiClass(nodeId)}>${renderTreeNode(nodeId, grouped[0].name)}${inlineDetailForNode(list, nodeId)}</li>`;
      }
      const nodeId = `group|${level}|${label}`;
      const reducedRest = rest.filter(nextLevel => {
        const values = [...new Set(grouped.map(item => groupValue(item, nextLevel)).filter(Boolean))];
        return !(values.length === 1 && normalized(values[0]) === normalized(label));
      });
      const nextHtml = reducedRest.length ? buildTree(grouped, reducedRest, `${path}-${label}`, list) : `<ul class="tree-level">${grouped.map(item => {
        const itemNodeId = `item:${item.name}`;
        return `<li${nodeLiClass(itemNodeId)}>${renderTreeNode(itemNodeId, item.name)}${inlineDetailForNode(list, itemNodeId)}</li>`;
      }).join('')}</ul>`;
      return `<li${nodeLiClass(nodeId)}>${renderTreeNode(nodeId, label, grouped.length)}${inlineDetailForNode(list, nodeId, level, label, grouped)}${nextHtml}</li>`;
    }).join('')}</ul>`;
  }

  function treePath(item) {
    const values = [
      titleCase(item.entityType),
      groupValue(item, 'domainBranch'),
      groupValue(item, 'typePrimary'),
      groupValue(item, 'typeSecondary')
    ].filter(Boolean);
    const cleaned = [];
    for (const value of values) {
      if (value === 'Specific entries' || value === 'Unspecified') continue;
      if (!cleaned.length || normalized(cleaned[cleaned.length - 1]) !== normalized(value)) cleaned.push(value);
    }
    return cleaned;
  }

  function matchesText(item, needle) {
    const hay = [
      item.name, item.entityType, item.category, item.subtype, item.typeLabel, item.gram, item.oxygen, item.pathogenicity,
      item.zoonoticStatus || '', item.reportingStatus || '', item.publicHealthNotes || '', item.mechanism || '', item.mechanismGroup || '',
      ...(item.diseaseLinks || []), ...(item.clinicalSigns || []), ...(item.uses || []), ...(item.contraindications || []),
      ...(item.hosts || []), ...(item.speciesFocus || []), ...(item.systems || []), ...(item.transmission || []),
      ...(item.routes || []), ...(item.cautionTags || []), ...(item.zoonosisSourceMentions || []),
      ...(item.reportingSourceMentions || []), item.notes || '', ...(item.sourceMentions || []),
      item.diseaseClass || '', ...(item.causativePathogens || []), ...(item.pathogenesis || []),
      ...(item.managementDrugs || []), ...(item.managementPlan || [])
    ].join(' ').toLowerCase();
    return hay.includes(needle);
  }

  function currentItems() {
    const needle = controls.search.value.trim().toLowerCase();
    const list = entities.filter(item => {
      if (needle && !matchesText(item, needle)) return false;
      if (controls.entityType.value && normalized(titleCase(item.entityType)) !== normalized(controls.entityType.value)) return false;
      if (controls.typeLabel.value && item.typeLabel !== controls.typeLabel.value) return false;
      if (controls.category.value && item.category !== controls.category.value) return false;
      if (controls.gram.value && item.gram !== controls.gram.value) return false;
      if (controls.oxygen.value && item.oxygen !== controls.oxygen.value) return false;
      if (controls.pathogenicity.value && item.pathogenicity !== controls.pathogenicity.value) return false;
      if (controls.source.value && !(item.sourceMentions || []).includes(controls.source.value)) return false;
      if (controls.speciesFocus.value && !hostValues(item).includes(controls.speciesFocus.value)) return false;
      if (controls.system.value && !(item.systems || []).includes(controls.system.value)) return false;
      if (controls.transmission.value && !(item.transmission || []).includes(controls.transmission.value)) return false;
      if (controls.zoonoticStatus.value && item.zoonoticStatus !== controls.zoonoticStatus.value) return false;
      if (controls.reportingStatus.value && item.reportingStatus !== controls.reportingStatus.value) return false;
      if (controls.route.value && !(item.routes || []).includes(controls.route.value)) return false;
      if (controls.mechanismGroup.value && item.mechanismGroup !== controls.mechanismGroup.value) return false;
      if (controls.cautionTag.value && !(item.cautionTags || []).includes(controls.cautionTag.value)) return false;
      if (controls.diseaseClass.value && item.diseaseClass !== controls.diseaseClass.value) return false;
      if (controls.iloOnly.checked && !item.inIlo) return false;
      if (controls.contraOnly.checked && !(item.contraindications || []).length) return false;
      if (controls.zoonoticOnly.checked && !(item.entityType === 'pathogen' && ['Confirmed', 'Limited/rare', 'Conditional'].includes(item.zoonoticStatus))) return false;
      if (controls.reportableOnly.checked && !(item.entityType === 'pathogen' && ['Notifiable', 'Reportable', 'Conditional'].includes(item.reportingStatus))) return false;
      if (controls.drugOnly.checked && item.entityType !== 'drug') return false;
      if (controls.pathogenOnly.checked && item.entityType !== 'pathogen') return false;
      if (controls.diseaseOnly.checked && item.entityType !== 'disease') return false;
      return true;
    });
    const sortBy = controls.sortBy.value;
    list.sort((a, b) => {
      if (sortBy === 'sources') return (b.sourceCount || 0) - (a.sourceCount || 0) || a.name.localeCompare(b.name);
      if (sortBy === 'type') return (a.typeLabel || '').localeCompare(b.typeLabel || '') || a.name.localeCompare(b.name);
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
      if (sortBy === 'pathogenicity') return (a.pathogenicity || '').localeCompare(b.pathogenicity || '') || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  function currentTestPool() {
    const list = currentItems();
    if (controls.testScope.value === 'all') return list;
    return list.filter(item => item.entityType === controls.testScope.value);
  }

  function clueCandidates(item, pool) {
    const path = treePath(item);
    const pathDefs = path.map((part, idx) => [idx === 0 ? 'Entity type' : idx === 1 ? 'Primary branch' : 'Sub-branch', part, x => treePath(x)[idx] === part]);
    const extras = [
      ['Body system', (item.systems || [])[0], x => (x.systems || []).includes((item.systems || [])[0])],
      ['Host / species', hostValues(item)[0], x => hostValues(x).includes(hostValues(item)[0])],
      ['Gram stain', item.gram, x => x.gram === item.gram],
      ['Oxygen preference', item.oxygen, x => x.oxygen === item.oxygen],
      ['Pathogenicity', item.pathogenicity, x => x.pathogenicity === item.pathogenicity],
      ['Zoonotic status', item.zoonoticStatus, x => x.zoonoticStatus === item.zoonoticStatus],
      ['Reporting status', item.reportingStatus, x => x.reportingStatus === item.reportingStatus],
      ['Disease class', item.diseaseClass, x => x.diseaseClass === item.diseaseClass]
    ].filter(([, value]) => !!value);
    const defs = [...pathDefs, ...extras];
    const clues = [];
    let currentPool = [...pool];
    for (const def of defs) {
      const nextPool = currentPool.filter(def[2]);
      if (!nextPool.length || nextPool.length === currentPool.length) continue;
      clues.push({ label: `${def[0]}: ${def[1]}`, pool: nextPool });
      currentPool = nextPool;
      if (currentPool.length === 1) break;
    }
    if (!clues.length) clues.push({ label: `Entity type: ${titleCase(item.entityType)}`, pool: currentPool });
    return clues;
  }

  function clueLines(item) {
    const lines = treePath(item).map((part, idx) => [idx === 0 ? 'Entity type' : idx === 1 ? 'Primary branch' : 'Sub-branch', part]);
    const extras = [
      ['Body system', (item.systems || []).join(', ')],
      ['Host / species', hostValues(item).join(', ')],
      ['Gram stain', item.gram],
      ['Oxygen preference', item.oxygen],
      ['Pathogenicity', item.pathogenicity],
      ['Routes', (item.routes || []).join(', ')],
      ['Mechanism', item.mechanism],
      ['Transmission', (item.transmission || []).join(', ')],
      ['Zoonotic status', item.zoonoticStatus],
      ['Reporting status', item.reportingStatus],
      ['Disease class', item.diseaseClass]
    ].filter(([, v]) => !!v);
    return [...lines, ...extras].slice(0, 6);
  }

  function focusAnswerBox() {
    const box = $('testAnswerBox');
    if (box) {
      box.focus();
      box.select();
    }
  }

  function renderNarrowing(feedback = '') {
    const visibleClues = testState.clues.slice(0, testState.step + 1);
    const currentPool = visibleClues.length ? visibleClues[visibleClues.length - 1].pool : currentTestPool();
    testState.pool = currentPool;
    $('testView').innerHTML = `
      <div class="small-muted">Start broad, answer with any valid matching entry, and narrow the branch until only one answer is left.</div>
      ${visibleClues.map((clue, idx) => `<div class="test-clue"><strong>Clue ${idx + 1}.</strong> ${esc(clue.label)} <span class="small-muted">(${clue.pool.length} matches)</span></div>`).join('')}
      <div class="inline-grid">
        <input id="testAnswerBox" class="test-answer" placeholder="Type the matching entity name">
        <button id="checkTestAnswer" type="button">Check answer</button>
      </div>
      ${feedback}
      ${testState.answered ? `<div class="test-clue"><strong>Answer:</strong> ${esc(testState.item.name)}<br><span class="small-muted">${esc([...treePath(testState.item), testState.item.name].join(' -> '))}</span></div>` : ''}
    `;
    $('checkTestAnswer').addEventListener('click', () => {
      const value = $('testAnswerBox').value;
      const matched = currentPool.find(entry => fuzzyEquals(value, entry.name));
      if (!matched) {
        renderNarrowing('<div class="test-feedback bad">That answer does not fit the current clue set.</div>');
        focusAnswerBox();
        return;
      }
      if (testState.step < testState.clues.length - 1) {
        testState.step += 1;
        renderNarrowing('<div class="test-feedback ok">Correct. Narrowing further.</div>');
        focusAnswerBox();
        return;
      }
      testState.answered = true;
      renderNarrowing(`<div class="test-feedback ok">Correct. The final remaining answer is ${esc(testState.item.name)}.</div>`);
    });
    $('testAnswerBox').addEventListener('keydown', evt => {
      if (evt.key === 'Enter') $('checkTestAnswer').click();
    });
    focusAnswerBox();
  }

  function renderFillTree(feedback = '') {
    const completed = testState.path.slice(0, testState.pathIndex);
    const remaining = testState.path.slice(testState.pathIndex);
    $('testView').innerHTML = `
      <div class="small-muted">Final entity: <strong>${esc(testState.item.name)}</strong>. Fill the tree path above it.</div>
      <div class="path-chips">
        ${completed.map(part => `<span class="path-chip done">${esc(part)}</span>`).join('')}
        ${remaining.map(part => `<span class="path-chip">${esc(part)}</span>`).join('')}
        <span class="path-chip done">${esc(testState.item.name)}</span>
      </div>
      <div class="inline-grid">
        <input id="testAnswerBox" class="test-answer" placeholder="Type the next tree segment">
        <button id="checkTestAnswer" type="button">Check answer</button>
      </div>
      ${feedback}
    `;
    $('checkTestAnswer').addEventListener('click', () => {
      const value = $('testAnswerBox').value;
      const target = testState.path[testState.pathIndex];
      if (!fuzzyEquals(value, target)) {
        renderFillTree(`<div class="test-feedback bad">Incorrect. The expected segment here is ${esc(target)}.</div>`);
        focusAnswerBox();
        return;
      }
      testState.pathIndex += 1;
      if (testState.pathIndex >= testState.path.length) {
        renderFillTree(`<div class="test-feedback ok">Complete. Full path: ${esc([...testState.path, testState.item.name].join(' -> '))}</div>`);
      } else {
        renderFillTree('<div class="test-feedback ok">Correct. Keep going.</div>');
        focusAnswerBox();
      }
    });
    $('testAnswerBox').addEventListener('keydown', evt => {
      if (evt.key === 'Enter') $('checkTestAnswer').click();
    });
    focusAnswerBox();
  }

  function renderMcq() {
    const clueHtml = clueLines(testState.item).map(([k, v]) => `<div class="mcq-clue"><strong>${esc(k)}:</strong> ${esc(v)}</div>`).join('');
    $('testView').innerHTML = `
      <div class="small-muted">Choose the single entry that matches all of the clues below.</div>
      ${clueHtml}
      <div class="mcq-grid">
        ${testState.options.map((opt, idx) => `<button class="mcq-option" data-idx="${idx}" type="button">${esc(opt.name)}</button>`).join('')}
      </div>
    `;
    Array.from(document.querySelectorAll('.mcq-option')).forEach(btn => {
      btn.addEventListener('click', () => {
        if (testState.answered) return;
        testState.answered = true;
        const idx = Number(btn.dataset.idx);
        const chosen = testState.options[idx];
        const correct = testState.item;
        Array.from(document.querySelectorAll('.mcq-option')).forEach((optBtn, i) => {
          const opt = testState.options[i];
          if (opt.name === correct.name) optBtn.classList.add('correct');
          if (opt.name === chosen.name && opt.name !== correct.name) optBtn.classList.add('incorrect');
        });
        const msg = chosen.name === correct.name
          ? `<div class="test-feedback ok">Correct. Meaningful path: ${esc([...treePath(correct), correct.name].join(' -> '))}</div>`
          : `<div class="test-feedback bad">Incorrect. Correct answer: ${esc(correct.name)}. Meaningful path: ${esc([...treePath(correct), correct.name].join(' -> '))}</div>`;
        $('testView').insertAdjacentHTML('beforeend', msg);
      });
    });
  }

  function renderTest() {
    const pool = currentTestPool();
    $('resultCount').textContent = `${pool.length} entries in current test pool`;
    $('testMeta').textContent = `${pool.length} filtered entries available for test mode. The test uses the same active filters as cards and tree.`;
    $('nextClue').style.display = controls.testType.value === 'narrowing' ? 'block' : 'none';
    if (!testState.item || !pool.some(x => x.name === testState.item.name) || testState.mode !== controls.testType.value) {
      startNewTest();
      return;
    }
    if (testState.mode === 'narrowing') return renderNarrowing();
    if (testState.mode === 'fillTree') return renderFillTree();
    return renderMcq();
  }

  function startNewTest() {
    const pool = currentTestPool();
    testState.mode = controls.testType.value;
    testState.answered = false;
    if (!pool.length) {
      $('testView').innerHTML = '<div class="test-feedback bad">No entries match the current filters for test mode.</div>';
      return;
    }
    testState.item = pool[Math.floor(Math.random() * pool.length)];
    if (testState.mode === 'narrowing') {
      testState.clues = clueCandidates(testState.item, pool);
      testState.step = 0;
      renderNarrowing();
      return;
    }
    if (testState.mode === 'fillTree') {
      testState.path = treePath(testState.item);
      testState.pathIndex = 0;
      renderFillTree();
      return;
    }
    const siblingPool = pool.filter(x => x.entityType === testState.item.entityType && x.name !== testState.item.name);
    const distractors = [...siblingPool].sort(() => Math.random() - 0.5).slice(0, 3);
    testState.options = [testState.item, ...distractors].sort(() => Math.random() - 0.5);
    renderMcq();
  }

  function renderCards() {
    const list = currentItems();
    $('resultCount').textContent = `${list.length} matching entries`;
    $('cards').innerHTML = list.length
      ? list.map(renderEntityCard).join('')
      : '<article class="card"><h3>No matches</h3><div>Adjust the filters or broaden the search.</div></article>';
  }

  function renderTree() {
    const list = currentItems();
    $('resultCount').textContent = `${list.length} matching entries`;
    $('treeView').classList.toggle('tree-focus', treeFullscreen);
    document.body.classList.toggle('tree-fullscreen', treeFullscreen);
    $('treeFullscreen').textContent = treeFullscreen ? 'Exit fullscreen' : 'Expand tree';
    $('treeView').hidden = false;
    $('treeView').style.display = 'grid';
    $('tree').hidden = false;
    $('tree').style.display = 'block';
    if (selectedTreeNode && selectedTreeNode.startsWith('item:') && !list.some(item => `item:${item.name}` === selectedTreeNode)) selectedTreeNode = '';
    if (selectedTreeNode && selectedTreeNode.startsWith('group|')) {
      const [, field, label] = selectedTreeNode.split('|');
      if (!list.some(item => groupValue(item, field) === label)) selectedTreeNode = '';
    }
    const levels = autoLevels(controls.treeRoot.value);
    const treeHtml = list.length
      ? `<ul class="org-tree tree-level"><li${nodeLiClass('root')}>${renderTreeNode('root', 'All entries', list.length)}${inlineDetailForNode(list, 'root')}${buildTree(list, levels, 'root', list)}</li></ul>`
      : '<article class="card"><h3>No matches</h3><div>Adjust the filters or broaden the search.</div></article>';
    $('tree').innerHTML = `<div class="tree-scene" style="transform: scale(${treeScale});">${treeHtml}</div>`;
  }

  function updateModeControls() {
    const isTree = controls.viewMode.value === 'tree';
    const isTest = controls.viewMode.value === 'test';
    $('testTypeField').hidden = !isTest;
    $('testScopeField').hidden = !isTest;
    controls.treeRoot.parentElement.hidden = !isTree;
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('active', key === controls.viewMode.value));
  }

  function renderByMode() {
    updateModeControls();
    if (controls.viewMode.value === 'cards') return renderCards();
    if (controls.viewMode.value === 'tree') return renderTree();
    return renderTest();
  }

  const zoonoticPathogenCount = entities.filter(item => item.entityType === 'pathogen' && ['Confirmed', 'Limited/rare', 'Conditional'].includes(item.zoonoticStatus)).length;
  const reportablePathogenCount = entities.filter(item => item.entityType === 'pathogen' && ['Notifiable', 'Reportable', 'Conditional'].includes(item.reportingStatus)).length;

  $('stats').innerHTML = [
    `Included sources: <strong>${DATA.summary.includedSourceCount}</strong>`,
    `Pathogens: <strong>${DATA.summary.pathogenCount}</strong>`,
    `Drugs: <strong>${DATA.summary.drugCount}</strong>`,
    `Diseases: <strong>${DATA.summary.diseaseCount || 0}</strong>`,
    `Zoonotic pathogens: <strong>${zoonoticPathogenCount}</strong>`,
    `Notifiable/reportable pathogens: <strong>${reportablePathogenCount}</strong>`,
    `Total entities: <strong>${DATA.summary.totalEntityCount}</strong>`
  ].map(v => `<div class="stat">${v}</div>`).join('');

  fill($('entityType'), 'entity types', uniq('entityType').map(titleCase));
  fill($('typeLabel'), 'specific types', uniq('typeLabel'));
  fill($('category'), 'categories', uniq('category'));
  fill($('gram'), 'Gram groups', uniq('gram'));
  fill($('oxygen'), 'oxygen groups', uniq('oxygen'));
  fill($('pathogenicity'), 'pathogenicity bands', uniq('pathogenicity'));
  fill($('source'), 'source files', [...new Set(entities.flatMap(e => e.sourceMentions || []))].sort((a, b) => a.localeCompare(b)));
  fill($('speciesFocus'), 'hosts / species', uniqList('speciesFocus').length ? uniqList('speciesFocus') : uniqList('hosts'));
  fill($('system'), 'body systems', uniqList('systems'));
  fill($('transmission'), 'transmission routes', uniqList('transmission'));
  fill($('zoonoticStatus'), 'zoonotic states', uniq('zoonoticStatus'));
  fill($('reportingStatus'), 'reporting states', uniq('reportingStatus'));
  fill($('route'), 'routes', uniqList('routes'));
  fill($('mechanismGroup'), 'mechanisms', uniq('mechanismGroup'));
  fill($('cautionTag'), 'caution tags', uniqList('cautionTags'));
  fill($('diseaseClass'), 'disease classes', uniq('diseaseClass'));
  controls.treeRoot.innerHTML = treeFields.map(field => `<option value="${field.value}">${field.label}</option>`).join('');
  controls.treeRoot.value = 'entityType';

  Object.values(controls).forEach(el => {
    if (!el) return;
    el.addEventListener('input', renderByMode);
    el.addEventListener('change', renderByMode);
  });

  $('treeFullscreen').addEventListener('click', () => {
    treeFullscreen = !treeFullscreen;
    renderByMode();
  });

  $('tree').addEventListener('click', event => {
    const node = event.target.closest('[data-node]');
    if (!node) return;
    const nodeId = node.getAttribute('data-node') || '';
    selectedTreeNode = selectedTreeNode === nodeId ? '' : nodeId;
    renderTree();
  });

  $('tree').addEventListener('wheel', event => {
    if (controls.viewMode.value !== 'tree') return;
    event.preventDefault();
    const tree = $('tree');
    const scene = tree.querySelector('.tree-scene');
    if (!scene) return;
    const oldScale = treeScale;
    const newScale = Math.min(2.4, Math.max(0.45, treeScale + (event.deltaY < 0 ? 0.08 : -0.08)));
    if (newScale === oldScale) return;
    const rect = tree.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const sceneWidth = scene.offsetWidth;
    const worldX = (tree.scrollLeft + offsetX - ((1 - oldScale) * sceneWidth / 2)) / oldScale;
    const worldY = (tree.scrollTop + offsetY) / oldScale;
    treeScale = newScale;
    scene.style.transform = `scale(${treeScale.toFixed(2)})`;
    tree.scrollLeft = Math.max(0, (newScale * worldX) + ((1 - newScale) * sceneWidth / 2) - offsetX);
    tree.scrollTop = Math.max(0, (newScale * worldY) - offsetY);
  }, { passive: false });

  $('tree').addEventListener('mousedown', event => {
    if (controls.viewMode.value !== 'tree') return;
    if (event.button !== 0) return;
    if (event.target.closest('.tree-node')) return;
    treePan = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: $('tree').scrollLeft,
      scrollTop: $('tree').scrollTop
    };
    $('tree').classList.add('panning');
  });

  window.addEventListener('mousemove', event => {
    if (!treePan) return;
    $('tree').scrollLeft = treePan.scrollLeft - (event.clientX - treePan.startX);
    $('tree').scrollTop = treePan.scrollTop - (event.clientY - treePan.startY);
  });

  window.addEventListener('mouseup', () => {
    treePan = null;
    $('tree').classList.remove('panning');
  });

  $('reset').addEventListener('click', () => {
    ['search', 'entityType', 'typeLabel', 'category', 'gram', 'oxygen', 'pathogenicity', 'source', 'speciesFocus', 'system', 'transmission', 'zoonoticStatus', 'reportingStatus', 'route', 'mechanismGroup', 'cautionTag', 'diseaseClass'].forEach(id => controls[id].value = '');
    ['iloOnly', 'contraOnly', 'zoonoticOnly', 'reportableOnly', 'drugOnly', 'pathogenOnly', 'diseaseOnly'].forEach(id => controls[id].checked = false);
    controls.sortBy.value = 'name';
    controls.viewMode.value = 'cards';
    controls.treeRoot.value = 'entityType';
    controls.testType.value = 'narrowing';
    controls.testScope.value = 'all';
    selectedTreeNode = '';
    treeScale = 1;
    treeFullscreen = false;
    testState.item = null;
    renderByMode();
  });

  $('copyVisible').addEventListener('click', async () => {
    const text = currentItems().map(item => item.name).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      $('copyVisible').textContent = 'Copied';
    } catch {
      $('copyVisible').textContent = 'Clipboard blocked';
    }
    setTimeout(() => { $('copyVisible').textContent = 'Copy visible names'; }, 1200);
  });

  $('newTest').addEventListener('click', startNewTest);
  $('nextClue').addEventListener('click', () => {
    if (controls.testType.value !== 'narrowing' || !testState.item) return;
    if (testState.step < testState.clues.length - 1) {
      testState.step += 1;
      renderNarrowing('<div class="test-feedback ok">Next clue revealed.</div>');
    } else {
      testState.answered = true;
      renderNarrowing(`<div class="test-feedback bad">No more clues. Answer: ${esc(testState.item.name)}.</div>`);
    }
  });

  renderByMode();
})();
