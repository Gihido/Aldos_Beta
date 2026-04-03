let selectedClass = "archer";
const CAPACITY = 50;

const gameState = {
  user: null,
  player: null,
  inventory: [],
  chest: [],
  equipped: { head: null, body: null, right_hand: null, left_hand: null, legs: null, gloves: null },
  skills: [],
  activePanel: "location",
  sidebarClosed: false,
  battle: null,
  respawns: {},
  locations: {},
  monsters: {}
};

const iconByType = { weapon: "⚔️", armor: "🛡️", consumable: "🧪", misc: "📦" };
const slotRu = { head: "Голова", body: "Тело", right_hand: "Правая рука", left_hand: "Левая рука", legs: "Ноги", gloves: "Перчатки" };

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const chance = p => Math.random() * 100 < p;
const sumWeight = arr => arr.reduce((s, i) => s + (Number(i.weight) || 0), 0);

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

function selectClass(classCode, el) {
  selectedClass = classCode;
  document.querySelectorAll(".class-card").forEach(card => card.classList.remove("active"));
  el.classList.add("active");
}

async function registerUser() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();
  const message = document.getElementById("message");
  const data = await api("/api/register", "POST", { username, password, classCode: selectedClass });
  if (message) message.textContent = data.message;
  if (data.success) setTimeout(() => location.href = "login.html", 700);
}

async function loginUser() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();
  const message = document.getElementById("message");
  const data = await api("/api/login", "POST", { username, password });
  if (message) message.textContent = data.message;
  if (data.success) setTimeout(() => location.href = "game.html", 500);
}

async function logout() {
  await persistGameState();
  await api('/api/logout', 'POST');
  location.href = 'login.html';
}

async function loadGame() {
  const data = await api("/api/game-data");
  if (!data.success) return location.href = "login.html";

  gameState.user = data.data.user;
  gameState.player = data.data.player;
  gameState.inventory = data.data.inventory || [];
  gameState.chest = data.data.chest || [];
  gameState.skills = data.data.skills || [];

  gameState.locations = {};
  (data.data.locations || []).forEach(l => {
    gameState.locations[l.code] = {
      name: l.name,
      description: l.description,
      next: l.next,
      prev: l.prev,
      image: l.image_url
    };
  });

  gameState.monsters = {};
  (data.data.monsters || []).forEach(m => {
    if (!gameState.monsters[m.location_code]) gameState.monsters[m.location_code] = [];
    gameState.monsters[m.location_code].push(m);
  });

  const eqRows = data.data.equipment || [];
  eqRows.forEach(row => {
    if (!row.item_id) return;
    let idx = gameState.inventory.findIndex(i => i.id === row.item_id);
    let source = 'inventory';
    if (idx < 0) { idx = gameState.chest.findIndex(i => i.id === row.item_id); source = 'chest'; }
    if (idx < 0) return;
    const item = source === 'inventory' ? gameState.inventory.splice(idx, 1)[0] : gameState.chest.splice(idx, 1)[0];
    gameState.equipped[row.slot_code] = item;
  });

  document.getElementById("playerName").textContent = gameState.user.username;
  document.getElementById("playerClass").textContent = `Класс: ${gameState.user.class_label}`;
  renderAll();
  switchPanel("location");

  setInterval(() => {
    if (!gameState.player) return;
    gameState.player.current_hp = Math.min(gameState.player.max_hp, gameState.player.current_hp + 1);
    gameState.player.current_mana = Math.min(gameState.player.max_mana, gameState.player.current_mana + 2);
    renderBars();
  }, 1000);

  setInterval(() => persistGameState(), 5000);
  window.addEventListener('beforeunload', persistGameState);
}

async function persistGameState() {
  if (!gameState.player || !gameState.user) return;
  await api('/api/player-state', 'POST', {
    player: gameState.player,
    inventory: gameState.inventory,
    chest: gameState.chest,
    equipped: gameState.equipped,
    skills: gameState.skills
  });
}

function renderAll() {
  renderBars();
  renderLocation();
  renderMonsters();
  renderInventory();
  renderChest();
  renderSkills();
  renderEquipment();
}
function currentLocation() { return gameState.locations[gameState.player.current_location]; }

function renderBars() {
  const p = gameState.player;
  if (!p) return;
  document.getElementById("hpText").textContent = `${p.current_hp}/${p.max_hp}`;
  document.getElementById("manaText").textContent = `${p.current_mana}/${p.max_mana}`;
  document.getElementById("hpBar").style.width = `${(p.current_hp / p.max_hp) * 100}%`;
  document.getElementById("manaBar").style.width = `${(p.current_mana / p.max_mana) * 100}%`;
  document.getElementById("invWeight").textContent = sumWeight(gameState.inventory);
  document.getElementById("chestWeight").textContent = sumWeight(gameState.chest);
}

function switchPanel(panel) {
  gameState.activePanel = panel;
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(`panel-${panel}`)?.classList.add('active');
  document.querySelectorAll('.tabs button[data-tab]').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${panel}`)?.classList.add('active');
}

function toggleSidebar() {
  gameState.sidebarClosed = !gameState.sidebarClosed;
  document.getElementById('sidebar').classList.toggle('closed', gameState.sidebarClosed);
}

function renderLocation() {
  const loc = currentLocation();
  if (!loc) return;
  document.getElementById('locationTitle').textContent = loc.name;
  document.getElementById('locationDescription').textContent = loc.description;
  document.getElementById('locationHero').style.backgroundImage = `url('${loc.image}')`;
  const actions = document.getElementById('locationActions');
  actions.innerHTML = '';
  if (loc.prev) actions.innerHTML += `<button class='btn secondary' onclick="moveLocation('${loc.prev}')">← Назад</button>`;
  if (loc.next) actions.innerHTML += `<button class='btn' onclick="moveLocation('${loc.next}')">Вперёд →</button>`;
}

function animateTravel(title, cb) {
  const o = document.getElementById('travelOverlay');
  const p = document.getElementById('travelProgress');
  const t = document.getElementById('travelText');
  t.textContent = title;
  p.style.width = '0%';
  o.classList.add('open');
  let k = 0;
  const i = setInterval(() => {
    k += 10;
    p.style.width = `${k}%`;
    if (k >= 100) {
      clearInterval(i);
      o.classList.remove('open');
      cb();
    }
  }, 70);
}

function moveLocation(code) {
  const from = currentLocation();
  const to = gameState.locations[code];
  if (!to) return;
  animateTravel(`Переход: ${from.name} → ${to.name}`, () => {
    gameState.player.current_location = code;
    renderLocation();
    renderMonsters();
    renderChest();
  });
}

function renderMonsters() {
  const list = document.getElementById('monsterList');
  const monsters = gameState.monsters[gameState.player.current_location] || [];
  list.innerHTML = monsters.map(m => {
    const deadUntil = gameState.respawns[m.id] || 0;
    const dead = Date.now() < deadUntil;
    const sec = Math.max(0, Math.ceil((deadUntil - Date.now()) / 1000));
    return `<div class='monster-card'>
      <div class='monster-image' style="background-image:url('${m.image}')"></div>
      <div class='row'><strong>${m.name}</strong><span class='small'>HP ${m.hp}</span></div>
      <div class='small'>Атака ${m.minDamage}-${m.maxDamage}</div>
      <div class='small'>Лут: ${m.loot.map(l => `${l.name} (${l.chance}%)`).join(', ')}</div>
      <button class='btn' ${dead ? 'disabled' : ''} onclick="startBattle('${m.id}')">${dead ? `Возрождение ${sec}с` : 'Атаковать'}</button>
    </div>`;
  }).join('');
}

function statsLine(item) {
  if (item.item_type === 'weapon') return `Урон: ${item.min_damage}-${item.max_damage} • Вес: ${item.weight}`;
  if (item.item_type === 'armor') return `Броня: ${item.armor || 0} • Вес: ${item.weight}`;
  if (item.item_type === 'consumable') return `${item.heal_hp ? `HP +${item.heal_hp}` : ''}${item.heal_hp && item.heal_mana ? ', ' : ''}${item.heal_mana ? `Мана +${item.heal_mana}` : ''} • Вес: ${item.weight}`;
  return `Вес: ${item.weight}`;
}

function itemCard(item, place) {
  const canEquip = item.item_type === 'weapon' || item.item_type === 'armor';
  const useBtn = canEquip
    ? `<button class='btn' onclick='equipItem(${item.id},"${place}")'>Экипировать</button>`
    : `<button class='btn' onclick='useItem(${item.id},"${place}")'>Использовать</button>`;
  const transfer = place === 'inventory'
    ? `<button class='btn secondary' onclick='moveItem(${item.id},"inventory","chest")'>В сундук</button>`
    : `<button class='btn secondary' onclick='moveItem(${item.id},"chest","inventory")'>В сумку</button>`;
  return `<div class='item-card'><div class='item-top'><div class='thumb'>${iconByType[item.item_type] || '📦'}</div><div><strong>${item.name}</strong><div class='small'>${item.description || '-'}</div></div></div><div class='small'>${statsLine(item)}</div><div class='row'>${useBtn}${transfer}</div></div>`;
}

function renderInventory() {
  const list = document.getElementById('inventoryList');
  list.innerHTML = gameState.inventory.map(i => itemCard(i, 'inventory')).join('') || `<div class='small'>Сумка пуста</div>`;
}

function renderChest() {
  const list = document.getElementById('chestList');
  const state = document.getElementById('chestState');
  const enabled = gameState.player.current_location === 'street_lanterns';
  state.textContent = enabled ? 'Сундук доступен в этой локации.' : 'Сундук можно открыть только на первой улице.';
  list.innerHTML = enabled ? (gameState.chest.map(i => itemCard(i, 'chest')).join('') || `<div class='small'>Сундук пуст</div>`) : `<div class='small'>Перейдите на первую улицу.</div>`;
}

function getArr(name) { return name === 'inventory' ? gameState.inventory : gameState.chest; }

function moveItem(id, from, to) {
  if (to === 'chest' && gameState.player.current_location !== 'street_lanterns') return;
  const src = getArr(from), dst = getArr(to);
  const idx = src.findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = src[idx];
  if (sumWeight(dst) + (Number(item.weight) || 0) > CAPACITY) return;
  src.splice(idx, 1); dst.push(item);
  renderAll();
}

function equipItem(id, from) {
  const src = getArr(from);
  const idx = src.findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = src[idx];
  const slot = item.equip_slot;
  if (!slot) return;
  if ((slot === 'right_hand' || slot === 'left_hand') && item.item_type !== 'weapon') return;
  if ((slot !== 'right_hand' && slot !== 'left_hand') && item.item_type !== 'armor') return;

  const prev = gameState.equipped[slot];
  if (prev) {
    if (sumWeight(gameState.inventory) + (Number(prev.weight) || 0) > CAPACITY) return;
    gameState.inventory.push(prev);
  }

  gameState.equipped[slot] = item;
  src.splice(idx, 1);
  renderAll();
}

function unequip(slot) {
  const item = gameState.equipped[slot];
  if (!item) return;
  if (sumWeight(gameState.inventory) + (Number(item.weight) || 0) > CAPACITY) return;
  gameState.equipped[slot] = null;
  gameState.inventory.push(item);
  renderAll();
}

function useItem(id, from) {
  const arr = getArr(from);
  const idx = arr.findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = arr[idx];
  if (item.heal_hp && gameState.player.current_hp >= gameState.player.max_hp) return;
  if (item.heal_mana && gameState.player.current_mana >= gameState.player.max_mana) return;
  gameState.player.current_hp = Math.min(gameState.player.max_hp, gameState.player.current_hp + (item.heal_hp || 0));
  gameState.player.current_mana = Math.min(gameState.player.max_mana, gameState.player.current_mana + (item.heal_mana || 0));
  arr.splice(idx, 1);
  renderBars(); renderInventory(); renderChest();
}

function renderEquipment() {
  document.getElementById('equipmentSlots').innerHTML = Object.keys(slotRu).map(slot => {
    const it = gameState.equipped[slot];
    return `<div class='slot'><div class='small'>${slotRu[slot]}</div><strong>${it ? it.name : 'Пусто'}</strong><div class='small'>${it ? statsLine(it) : ''}</div>${it ? `<button class='btn secondary' onclick='unequip("${slot}")'>Снять</button>` : ''}</div>`;
  }).join('');
}

function renderSkills() {
  const html = gameState.skills.map(s => `
    <div class='item-card'>
      <strong>${s.name}</strong>
      <div class='small'>${s.description}</div>
      <div class='small'>Эффект: ${s.effect_type}, шанс ${s.effect_chance}%</div>
      <div class='row'>
        ${s.is_equipped ? `<button class='btn secondary' onclick='toggleSkill(${s.user_skill_id},0)'>Снять</button>` : `<button class='btn' onclick='toggleSkill(${s.user_skill_id},1)'>Экипировать</button>`}
      </div>
    </div>
  `).join('');
  document.getElementById('skillList').innerHTML = html || `<div class='small'>Нет доступных умений.</div>`;
}

function toggleSkill(userSkillId, equipped) {
  gameState.skills = gameState.skills.map(s => s.user_skill_id === userSkillId ? { ...s, is_equipped: equipped } : s);
  renderSkills();
}

function startBattle(monsterId) {
  const m = (gameState.monsters[gameState.player.current_location] || []).find(x => x.id === monsterId);
  if (!m) return;
  gameState.battle = { monster: { ...m, currentHp: m.hp, stunned: false }, turn: 10, acted: false, blockActive: false, logs: [], chosenSkillId: null };
  document.getElementById('battleMonsterImg').src = m.image;
  document.getElementById('battleOverlay').classList.add('open');
  runTurn();
}

function runTurn() {
  const b = gameState.battle;
  if (!b) return;
  b.turn = 10;
  b.acted = false;
  b.blockActive = false;
  updateBattleUI();

  b.timer = setInterval(() => {
    b.turn -= 1;
    updateBattleUI();
    if (b.turn <= 0) endTurn();
  }, 1000);

  b.monsterAttack = setTimeout(() => {
    if (!gameState.battle) return;
    if (b.monster.stunned) {
      b.logs.push('Монстр оглушён и пропустил атаку.');
      b.monster.stunned = false;
      updateBattleUI();
      return;
    }
    let dmg = rand(b.monster.minDamage, b.monster.maxDamage);
    if (b.blockActive) dmg = Math.max(0, Math.floor(dmg * 0.4));
    gameState.player.current_hp = Math.max(0, gameState.player.current_hp - dmg);
    b.logs.push(`Монстр ударил на ${dmg}.`);
    updateBattleUI();
    if (gameState.player.current_hp <= 0) finishBattle(false);
  }, rand(2, 7) * 1000);
}

function openSkillChooser() {
  const equippedSkills = gameState.skills.filter(s => s.is_equipped);
  const list = document.getElementById('skillChooserList');
  list.innerHTML = equippedSkills.map(s => `<button class='btn' onclick='battleAction("skill",${s.user_skill_id})'>${s.name}</button>`).join('') || '<div class="small">Нет экипированных умений.</div>';
  document.getElementById('skillChooser').classList.add('open');
}

function closeSkillChooser() {
  document.getElementById('skillChooser').classList.remove('open');
}

function battleAction(type, skillId = null) {
  const b = gameState.battle;
  if (!b || b.acted) return;
  b.acted = true;

  if (type === 'attack') {
    let dmg = rand(gameState.player.base_damage_min, gameState.player.base_damage_max);
    if (gameState.user.class_code === 'archer' && chance(10)) {
      dmg *= 2;
      b.logs.push('Крит! x2');
    }
    b.monster.currentHp = Math.max(0, b.monster.currentHp - dmg);
    b.logs.push(`Вы нанесли ${dmg}.`);
  } else if (type === 'skill') {
    closeSkillChooser();
    const skill = gameState.skills.find(s => s.user_skill_id === skillId);
    if (!skill) {
      b.logs.push('Умение не выбрано.');
    } else if ((gameState.player.current_mana || 0) < (skill.mana_cost || 0)) {
      b.logs.push('Недостаточно маны.');
    } else {
      gameState.player.current_mana = Math.max(0, gameState.player.current_mana - (skill.mana_cost || 0));
      if (skill.power) {
        b.monster.currentHp = Math.max(0, b.monster.currentHp - skill.power);
        b.logs.push(`${skill.name}: ${skill.power} урона.`);
      } else {
        b.logs.push(`${skill.name} использовано.`);
      }
      if (skill.effect_type === 'stun' && chance(skill.effect_chance || 0)) {
        b.monster.stunned = true;
        b.logs.push('Оглушение!');
      }
      if (skill.effect_type === 'block') {
        b.blockActive = true;
        b.logs.push('Блок активирован.');
      }
      if (skill.effect_type === 'crit_boost' && chance(skill.effect_chance || 0)) {
        const bonus = rand(gameState.player.base_damage_min, gameState.player.base_damage_max);
        b.monster.currentHp = Math.max(0, b.monster.currentHp - bonus);
        b.logs.push(`Доп. критический урон: ${bonus}.`);
      }
    }
  } else {
    b.logs.push('Вы ожидаете...');
  }

  updateBattleUI();
  if (b.monster.currentHp <= 0) finishBattle(true);
}

function endTurn() {
  const b = gameState.battle;
  if (!b) return;
  clearInterval(b.timer);
  clearTimeout(b.monsterAttack);
  if (b.monster.currentHp <= 0 || gameState.player.current_hp <= 0) return;
  runTurn();
}

function pushLoot(monster) {
  for (const l of monster.loot) {
    if (!chance(l.chance)) continue;
    const item = {
      id: -(Date.now() + Math.floor(Math.random() * 10000)),
      user_id: gameState.user.id,
      name: l.name,
      item_type: l.type,
      equip_slot: l.equip_slot || null,
      min_damage: l.min_damage || 0,
      max_damage: l.max_damage || 0,
      armor: l.armor || 0,
      heal_hp: l.heal_hp || 0,
      heal_mana: l.heal_mana || 0,
      weight: l.weight || 1,
      description: l.description || ''
    };
    if (sumWeight(gameState.inventory) + item.weight <= CAPACITY) {
      gameState.inventory.push(item);
      gameState.battle.logs.push(`Лут: ${item.name}`);
    } else {
      gameState.battle.logs.push(`Лут ${item.name} не поместился в сумку.`);
    }
  }
}

function finishBattle(win) {
  const b = gameState.battle;
  if (!b) return;
  clearInterval(b.timer);
  clearTimeout(b.monsterAttack);
  if (win) {
    b.logs.push('Победа! Возрождение монстра через 10 сек.');
    gameState.respawns[b.monster.id] = Date.now() + 10000;
    pushLoot(b.monster);
  } else {
    b.logs.push('Поражение. HP/мана сохраняются как после боя.');
  }
  updateBattleUI();
  setTimeout(() => {
    document.getElementById('battleOverlay').classList.remove('open');
    gameState.battle = null;
    renderAll();
    setTimeout(renderMonsters, 10000);
  }, 1300);
}

function updateBattleUI() {
  const b = gameState.battle;
  if (!b) return;
  document.getElementById('battleTitle').textContent = `Бой: ${b.monster.name}`;
  document.getElementById('battleTimer').textContent = b.turn;
  document.getElementById('battlePlayerHp').textContent = `Игрок: ${gameState.player.current_hp}/${gameState.player.max_hp}`;
  document.getElementById('battleMonsterHp').textContent = `Монстр: ${b.monster.currentHp}/${b.monster.hp}`;
  document.getElementById('battlePlayerBar').style.width = `${(gameState.player.current_hp / gameState.player.max_hp) * 100}%`;
  document.getElementById('battleMonsterBar').style.width = `${(b.monster.currentHp / b.monster.hp) * 100}%`;
  document.getElementById('battleLog').innerHTML = b.logs.map(l => `<div>• ${l}</div>`).join('');
  renderBars();
}

async function loadUsers() {
  await loadAdminAll();
}

async function loadAdminAll() {
  const [users, locations, monsters, loot, skills, items] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/locations'),
    api('/api/admin/monsters'),
    api('/api/admin/loot'),
    api('/api/admin/skills'),
    api('/api/admin/items')
  ]);

  const userList = document.getElementById('userList');
  userList.innerHTML = (users.users || []).map(u => `<div class='item-card'><b>${u.username}</b><div class='small'>${u.role} | ${u.class_code}</div><button class='btn warn' onclick='toggleBlock(${u.id})'>${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button></div>`).join('');

  document.getElementById('locationsList').innerHTML = (locations.locations || []).map(l => `<div class='item-card'><b>${l.name}</b><div class='small'>${l.code} | next:${l.next_code || '-'} | prev:${l.prev_code || '-'}</div></div>`).join('');
  document.getElementById('monstersList').innerHTML = (monsters.monsters || []).map(m => `<div class='item-card'><b>${m.name}</b><div class='small'>${m.code} (${m.location_code}) HP:${m.hp} DMG:${m.min_damage}-${m.max_damage}</div></div>`).join('');
  document.getElementById('lootList').innerHTML = (loot.loot || []).map(l => `<div class='item-card'><b>${l.name}</b><div class='small'>${l.monster_name} | ${l.chance}%</div></div>`).join('');
  document.getElementById('skillsList').innerHTML = (skills.skills || []).map(s => `<div class='item-card'><b>${s.name}</b><div class='small'>${s.class_code} | ${s.effect_type} ${s.effect_chance}%</div></div>`).join('');
  document.getElementById('itemsList').innerHTML = (items.items || []).map(i => `<div class='item-card'><b>${i.name}</b><div class='small'>${i.item_type} | ${i.description}</div></div>`).join('');

  const userOptions = (users.users || []).map(u => `<option value='${u.id}'>${u.username}</option>`).join('');
  const skillOptions = (skills.skills || []).map(s => `<option value='${s.id}'>${s.name}</option>`).join('');
  const itemOptions = (items.items || []).map(i => `<option value='${i.id}'>${i.name}</option>`).join('');
  document.getElementById('grantUser').innerHTML = userOptions;
  document.getElementById('grantSkill').innerHTML = skillOptions;
  document.getElementById('giveUser').innerHTML = userOptions;
  document.getElementById('giveItem').innerHTML = itemOptions;
}

async function toggleBlock(userId) {
  await api('/api/admin/toggle-block', 'POST', { userId });
  loadAdminAll();
}

function formData(formId) {
  const f = document.getElementById(formId);
  const data = {};
  new FormData(f).forEach((v, k) => data[k] = v);
  return data;
}

async function adminCreate(type, formId) {
  const map = { location: '/api/admin/locations', monster: '/api/admin/monsters', loot: '/api/admin/loot', skill: '/api/admin/skills', item: '/api/admin/items' };
  await api(map[type], 'POST', formData(formId));
  document.getElementById(formId).reset();
  loadAdminAll();
}

async function adminGrantSkill() {
  await api('/api/admin/grant-skill', 'POST', {
    userId: Number(document.getElementById('grantUser').value),
    skillId: Number(document.getElementById('grantSkill').value),
    is_equipped: document.getElementById('grantEquip').checked ? 1 : 0
  });
}

async function adminGiveItem() {
  await api('/api/admin/give-item', 'POST', {
    userId: Number(document.getElementById('giveUser').value),
    templateId: Number(document.getElementById('giveItem').value),
    storage: document.getElementById('giveStorage').value
  });
}
