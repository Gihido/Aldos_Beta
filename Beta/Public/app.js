let selectedClass = "archer";
const CAPACITY = 50;

const gameState = {
  user: null, player: null,
  inventory: [], chest: [],
  equipped: { head: null, body: null, right_hand: null, left_hand: null, legs: null, gloves: null },
  activePanel: "location", sidebarClosed: false,
  battle: null, respawns: {},
  locations: {
    street_lanterns: { name: "Первая улица", description: "Безопасный старт. Только здесь доступен сундук.", next: "old_square", prev: null, bg: "🏮" },
    old_square: { name: "Старая площадь", description: "Площадь с развалинами и патрулями нечисти.", next: "dark_gate", prev: "street_lanterns", bg: "🏛️" },
    dark_gate: { name: "Тёмные ворота", description: "Опасная зона с сильными врагами.", next: null, prev: "old_square", bg: "🗿" }
  },
  monsters: {
    street_lanterns: [{ id: "rat", name: "Гигантская крыса", hp: 45, minDamage: 2, maxDamage: 5, icon: "🐀", loot: [{ name: "Ржавый кинжал", type: "weapon", equip_slot: "right_hand", min_damage: 3, max_damage: 6, weight: 2, description: "Старый кинжал.", chance: 18 }] }],
    old_square: [{ id: "skeleton", name: "Скелет-воин", hp: 78, minDamage: 5, maxDamage: 9, icon: "💀", loot: [{ name: "Латные перчатки", type: "armor", equip_slot: "gloves", armor: 4, weight: 3, description: "Прочная защита рук.", chance: 20 }] }],
    dark_gate: [{ id: "ogre", name: "Огр-хранитель", hp: 110, minDamage: 6, maxDamage: 12, icon: "👹", loot: [{ name: "Большое зелье HP", type: "consumable", heal_hp: 35, weight: 2, description: "Сильное восстановление.", chance: 30 }] }]
  }
};

const iconByType = { weapon: "⚔️", armor: "🛡️", consumable: "🧪", misc: "📦" };
const slotRu = { head: "Голова", body: "Тело", right_hand: "Правая рука", left_hand: "Левая рука", legs: "Ноги", gloves: "Перчатки" };

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const chance = p => Math.random() * 100 < p;
const sumWeight = arr => arr.reduce((s, i) => s + (Number(i.weight) || 0), 0);

function selectClass(classCode, el) {
  selectedClass = classCode;
  document.querySelectorAll(".class-card").forEach(card => card.classList.remove("active"));
  el.classList.add("active");
}

async function registerUser() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();
  const message = document.getElementById("message");
  const response = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, classCode: selectedClass }) });
  const data = await response.json();
  if (message) message.textContent = data.message;
  if (data.success) setTimeout(() => location.href = "login.html", 700);
}

async function loginUser() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();
  const message = document.getElementById("message");
  const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const data = await response.json();
  if (message) message.textContent = data.message;
  if (data.success) setTimeout(() => location.href = "game.html", 500);
}

async function logout() { await fetch('/api/logout', { method: 'POST' }); location.href = 'login.html'; }

async function loadGame() {
  const response = await fetch("/api/game-data");
  const data = await response.json();
  if (!data.success) return location.href = "login.html";

  gameState.user = data.data.user;
  gameState.player = data.data.player;
  gameState.inventory = data.data.inventory || [];
  gameState.chest = data.data.chest || [];

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
}

function renderAll() { renderBars(); renderLocation(); renderMonsters(); renderInventory(); renderChest(); renderSkills(); renderEquipment(); }
function currentLocation() { return gameState.locations[gameState.player.current_location]; }

function renderBars() {
  const p = gameState.player;
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
  document.querySelectorAll('.tabs button').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${panel}`)?.classList.add('active');
}

function toggleSidebar() {
  gameState.sidebarClosed = !gameState.sidebarClosed;
  document.getElementById('sidebar').classList.toggle('closed', gameState.sidebarClosed);
}

function renderLocation() {
  const loc = currentLocation();
  document.getElementById('locationTitle').textContent = `${loc.bg} ${loc.name}`;
  document.getElementById('locationDescription').textContent = loc.description;
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
    k += 10; p.style.width = `${k}%`;
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
    return `<div class='monster-card'><div class='row'><strong>${m.icon} ${m.name}</strong><span class='small'>HP ${m.hp}</span></div>
      <div class='small'>Атака ${m.minDamage}-${m.maxDamage}</div>
      <div class='small'>Лут: ${m.loot.map(l => `${l.name} (${l.chance}%)`).join(', ')}</div>
      <button class='btn' ${dead ? 'disabled' : ''} onclick="startBattle('${m.id}')">${dead ? `Возрождение ${sec}с` : 'Атаковать'}</button></div>`;
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
  const arr = getArr(from); const idx = arr.findIndex(i => i.id === id); if (idx < 0) return;
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
  const cls = gameState.user.class_code;
  const items = cls === 'archer'
    ? [{ n: 'Точный выстрел', d: '10% шанс нанести двойной урон при атаке.' }]
    : cls === 'mage'
      ? [{ n: 'Магический импульс', d: '5 урона и 15% шанс оглушить на 1 ход.' }]
      : [{ n: 'Блок', d: 'Снижает урон от следующей атаки монстра в текущем ходу.' }];
  document.getElementById('skillList').innerHTML = items.map(s => `<div class='item-card'><strong>${s.n}</strong><div class='small'>${s.d}</div></div>`).join('');
}

function startBattle(monsterId) {
  const m = (gameState.monsters[gameState.player.current_location] || []).find(x => x.id === monsterId);
  if (!m) return;
  gameState.battle = { monster: { ...m, currentHp: m.hp, stunned: false }, turn: 10, acted: false, blockActive: false, logs: [] };
  document.getElementById('battleMonsterImg').src = `https://placehold.co/360x160/4a3f37/fff?text=${encodeURIComponent(m.name)}`;
  document.getElementById('battleOverlay').classList.add('open');
  runTurn();
}

function runTurn() {
  const b = gameState.battle; if (!b) return;
  b.turn = 10; b.acted = false; b.blockActive = false;
  updateBattleUI();

  b.timer = setInterval(() => { b.turn -= 1; updateBattleUI(); if (b.turn <= 0) endTurn(); }, 1000);
  b.monsterAttack = setTimeout(() => {
    if (!gameState.battle) return;
    if (b.monster.stunned) { b.logs.push('Монстр оглушён и пропустил атаку.'); b.monster.stunned = false; updateBattleUI(); return; }
    let dmg = rand(b.monster.minDamage, b.monster.maxDamage);
    if (b.blockActive) dmg = Math.max(0, Math.floor(dmg * 0.4));
    gameState.player.current_hp = Math.max(0, gameState.player.current_hp - dmg);
    b.logs.push(`Монстр ударил на ${dmg}.`);
    updateBattleUI();
    if (gameState.player.current_hp <= 0) finishBattle(false);
  }, rand(2, 7) * 1000);
}

function battleAction(type) {
  const b = gameState.battle; if (!b || b.acted) return;
  b.acted = true;

  if (type === 'attack') {
    let dmg = rand(gameState.player.base_damage_min, gameState.player.base_damage_max);
    if (gameState.user.class_code === 'archer' && chance(10)) { dmg *= 2; b.logs.push('Крит! x2'); }
    b.monster.currentHp = Math.max(0, b.monster.currentHp - dmg);
    b.logs.push(`Вы нанесли ${dmg}.`);
  } else if (type === 'skill') {
    if (gameState.user.class_code === 'mage') {
      b.monster.currentHp = Math.max(0, b.monster.currentHp - 5);
      if (chance(15)) { b.monster.stunned = true; b.logs.push('Оглушение!'); }
      b.logs.push('Магический импульс: 5 урона.');
    } else if (gameState.user.class_code === 'orc') {
      b.blockActive = true;
      b.logs.push('Блок активирован.');
    } else {
      b.logs.push('Лучник концентрируется.');
    }
  } else {
    b.logs.push('Вы ожидаете...');
  }

  updateBattleUI();
  if (b.monster.currentHp <= 0) finishBattle(true);
}

function endTurn() {
  const b = gameState.battle; if (!b) return;
  clearInterval(b.timer); clearTimeout(b.monsterAttack);
  if (b.monster.currentHp <= 0 || gameState.player.current_hp <= 0) return;
  runTurn();
}

function pushLoot(monster) {
  for (const l of monster.loot) {
    if (!chance(l.chance)) continue;
    const item = { id: Date.now() + Math.floor(Math.random() * 10000), user_id: gameState.user.id, name: l.name, item_type: l.type, equip_slot: l.equip_slot || null, min_damage: l.min_damage || 0, max_damage: l.max_damage || 0, armor: l.armor || 0, heal_hp: l.heal_hp || 0, heal_mana: l.heal_mana || 0, weight: l.weight || 1, description: l.description || '' };
    if (sumWeight(gameState.inventory) + item.weight <= CAPACITY) {
      gameState.inventory.push(item);
      gameState.battle.logs.push(`Лут: ${item.name}`);
    } else {
      gameState.battle.logs.push(`Лут ${item.name} не поместился в сумку.`);
    }
  }
}

function finishBattle(win) {
  const b = gameState.battle; if (!b) return;
  clearInterval(b.timer); clearTimeout(b.monsterAttack);
  if (win) { b.logs.push('Победа! Возрождение монстра через 10 сек.'); gameState.respawns[b.monster.id] = Date.now() + 10000; pushLoot(b.monster); }
  else { b.logs.push('Поражение. HP/мана сохраняются как после боя.'); }
  updateBattleUI();
  setTimeout(() => { document.getElementById('battleOverlay').classList.remove('open'); gameState.battle = null; renderAll(); setTimeout(renderMonsters, 10000); }, 1300);
}

function updateBattleUI() {
  const b = gameState.battle; if (!b) return;
  document.getElementById('battleTitle').textContent = `Бой: ${b.monster.name}`;
  document.getElementById('battleTimer').textContent = b.turn;
  document.getElementById('battlePlayerHp').textContent = `Игрок: ${gameState.player.current_hp}/${gameState.player.max_hp}`;
  document.getElementById('battleMonsterHp').textContent = `Монстр: ${b.monster.currentHp}/${b.monster.hp}`;
  document.getElementById('battlePlayerBar').style.width = `${(gameState.player.current_hp / gameState.player.max_hp) * 100}%`;
  document.getElementById('battleMonsterBar').style.width = `${(b.monster.currentHp / b.monster.hp) * 100}%`;
  document.getElementById('battleLog').innerHTML = b.logs.map(l => `<div>• ${l}</div>`).join('');
  renderBars();
}

async function loadDashboard() {
  const res = await fetch('/api/game-data');
  const data = await res.json();
  if (!data.success) return location.href = 'login.html';
  document.getElementById('userInfo').innerHTML = `Игрок: ${data.data.user.username}<br>Класс: ${data.data.user.class_label}<br>HP: ${data.data.player.current_hp}/${data.data.player.max_hp}`;
}

async function loadUsers() {
  const list = document.getElementById('userList');
  const res = await fetch('/api/admin/users');
  const data = await res.json();
  if (!data.success) return list.innerHTML = '<div class="small">Недостаточно прав.</div>';
  list.innerHTML = data.users.map(u => `<div class='item-card'><b>${u.username}</b><div class='small'>${u.role} | ${u.class_code}</div><button class='btn warn' onclick='toggleBlock(${u.id})'>${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button></div>`).join('');
}

async function toggleBlock(userId) {
  await fetch('/api/admin/toggle-block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
  loadUsers();
}
