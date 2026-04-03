let selectedClass = "archer";
const gameState = {
    user: null,
    player: null,
    inventory: [],
    chest: [],
    equipment: {},
    activePanel: "location",
    chestOpen: false,
    battle: null,
    locations: {
        street_lanterns: { name: "Первая улица", description: "Здесь можно открыть сундук и охотиться на слабых врагов.", chestAvailable: true, next: "old_square" },
        old_square: { name: "Старая площадь", description: "Более опасная локация. Сундук недоступен.", chestAvailable: false, next: "dark_gate" },
        dark_gate: { name: "Тёмные ворота", description: "Последний участок дороги перед руинами.", chestAvailable: false, next: null }
    },
    monsters: {
        street_lanterns: [
            { id: "rat", name: "Гигантская крыса", hp: 45, minDamage: 2, maxDamage: 5, loot: [{ name: "Ржавый кинжал", type: "weapon", equip_slot: "right_hand", min_damage: 3, max_damage: 6, weight: 2, description: "Старый кинжал.", chance: 18 }] },
            { id: "thief", name: "Уличный вор", hp: 60, minDamage: 3, maxDamage: 7, loot: [{ name: "Лёгкие перчатки", type: "armor", equip_slot: "gloves", armor: 3, weight: 1, description: "Перчатки из кожи.", chance: 22 }] }
        ],
        old_square: [{ id: "skeleton", name: "Скелет-воин", hp: 78, minDamage: 5, maxDamage: 9, loot: [{ name: "Зелье маны", type: "consumable", heal_mana: 35, weight: 1, description: "Восстанавливает ману.", chance: 26 }] }],
        dark_gate: [{ id: "ogre", name: "Огр-хранитель", hp: 110, minDamage: 6, maxDamage: 12, loot: [{ name: "Латный шлем", type: "armor", equip_slot: "head", armor: 7, weight: 5, description: "Тяжелый шлем.", chance: 15 }] }]
    },
    respawns: {}
};

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function chance(p) { return Math.random() * 100 < p; }

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
    if (data.success) setTimeout(() => location.href = "login.html", 800);
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

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.href = 'login.html';
}

function toast(msg) {
    const el = document.getElementById("battleInfo") || document.getElementById("message");
    if (el) el.textContent = msg;
}

function switchPanel(panel) {
    gameState.activePanel = panel;
    document.querySelectorAll(".screen").forEach(e => e.classList.remove("active"));
    document.getElementById(`panel-${panel}`)?.classList.add("active");
    document.querySelectorAll(".tabs button").forEach(e => e.classList.remove("active"));
    document.getElementById(`tab-${panel}`)?.classList.add("active");
}

async function loadGame() {
    const response = await fetch("/api/game-data");
    const data = await response.json();
    if (!data.success) return location.href = "login.html";

    gameState.user = data.data.user;
    gameState.player = data.data.player;
    gameState.inventory = data.data.inventory || [];
    gameState.chest = data.data.chest || [];
    gameState.equipment = (data.data.equipment || []).reduce((acc, s) => (acc[s.slot_code] = s.item_id, acc), {});

    document.getElementById("playerName").textContent = gameState.user.username;
    document.getElementById("playerClass").textContent = `Класс: ${gameState.user.class_label}`;

    renderAll();
    switchPanel("location");
}

function renderAll() {
    renderPlayerBars();
    renderLocation();
    renderMonsters();
    renderInventory();
    renderChest();
    renderSkills();
    renderEquipment();
}

function renderPlayerBars() {
    const p = gameState.player;
    document.getElementById("hpText").textContent = `${p.current_hp}/${p.max_hp}`;
    document.getElementById("manaText").textContent = `${p.current_mana}/${p.max_mana}`;
    document.getElementById("hpBar").style.width = `${(p.current_hp / p.max_hp) * 100}%`;
    document.getElementById("manaBar").style.width = `${(p.current_mana / p.max_mana) * 100}%`;
}

function currentLocation() { return gameState.locations[gameState.player.current_location]; }

function renderLocation() {
    const location = currentLocation();
    document.getElementById("locationTitle").textContent = location.name;
    document.getElementById("locationDescription").textContent = location.description;
    const actions = document.getElementById("locationActions");
    actions.innerHTML = "";
    if (location.next) actions.innerHTML = `<button class='btn secondary' onclick="moveLocation('${location.next}')">Перейти дальше</button>`;

    const chestBtn = document.getElementById("chestToggleBtn");
    chestBtn.disabled = !location.chestAvailable;
    chestBtn.textContent = location.chestAvailable ? "Открыть сундук" : "Сундук недоступен в этой локации";
    if (!location.chestAvailable) document.getElementById("chestWrap").style.display = "none";
}

function moveLocation(code) {
    gameState.player.current_location = code;
    gameState.chestOpen = false;
    renderLocation();
    renderMonsters();
}

function renderMonsters() {
    const list = document.getElementById("monsterList");
    const loc = gameState.player.current_location;
    const monsters = gameState.monsters[loc] || [];
    list.innerHTML = monsters.map(m => {
        const deadUntil = gameState.respawns[m.id] || 0;
        const dead = Date.now() < deadUntil;
        const sec = Math.max(0, Math.ceil((deadUntil - Date.now()) / 1000));
        return `<div class="card ${dead ? 'monster-dead' : ''}"><strong>${m.name}</strong>
            <div class='small'>HP: ${m.hp} | Атака: ${m.minDamage}-${m.maxDamage}</div>
            <div class='small'>Лут: ${m.loot.map(l => `${l.name} (${l.chance}%)`).join(', ')}</div>
            <button class='btn' ${dead ? 'disabled' : ''} onclick="startBattle('${m.id}')">${dead ? `Возрождение ${sec}с` : 'Атаковать'}</button></div>`;
    }).join("");
}

function itemCard(item, storage) {
    let stats = "";
    if (item.item_type === "weapon") stats = `Атака: ${item.min_damage}-${item.max_damage}, Вес: ${item.weight}`;
    if (item.item_type === "armor") stats = `Броня: ${item.armor || 0}, Вес: ${item.weight}`;
    if (item.item_type === "consumable") stats = `${item.heal_hp ? `HP +${item.heal_hp}` : ''} ${item.heal_mana ? `Мана +${item.heal_mana}` : ''}, Вес: ${item.weight}`;
    const canEquip = item.item_type === "weapon" || item.item_type === "armor";
    const actionBtn = canEquip
        ? `<button class='btn' onclick='equipItem(${JSON.stringify(item).replace(/"/g, "&quot;")})'>Экипировать</button>`
        : `<button class='btn' onclick='useItem(${JSON.stringify(item).replace(/"/g, "&quot;")}, "${storage}")'>Использовать</button>`;
    return `<div class='card'><strong>${item.name}</strong><div class='small'>${item.description || '-'}</div><div class='small'>${stats}</div><div class='row'>${actionBtn}${storage === 'inventory' ? `<button class='btn secondary' onclick='moveToChest(${item.id})'>В сундук</button>` : `<button class='btn secondary' onclick='moveToInventory(${item.id})'>В инвентарь</button>`}</div></div>`;
}

function renderInventory() { document.getElementById("inventoryList").innerHTML = gameState.inventory.map(i => itemCard(i, "inventory")).join("") || "<div class='small'>Пусто</div>"; }
function renderChest() { document.getElementById("chestList").innerHTML = gameState.chest.map(i => itemCard(i, "chest")).join("") || "<div class='small'>Пусто</div>"; }

function toggleChest() {
    if (!currentLocation().chestAvailable) return toast("Сундук доступен только на первой улице");
    gameState.chestOpen = !gameState.chestOpen;
    document.getElementById("chestWrap").style.display = gameState.chestOpen ? "block" : "none";
}

function moveToChest(id) { const i = gameState.inventory.findIndex(x => x.id === id); if (i >= 0) gameState.chest.push(...gameState.inventory.splice(i, 1)); renderInventory(); renderChest(); }
function moveToInventory(id) { const i = gameState.chest.findIndex(x => x.id === id); if (i >= 0) gameState.inventory.push(...gameState.chest.splice(i, 1)); renderInventory(); renderChest(); }

function renderSkills() {
    const cls = gameState.user.class_code;
    const skills = cls === "archer"
        ? [{ name: "Точный выстрел", text: "10% шанс двойного урона." }]
        : cls === "mage"
            ? [{ name: "Магический импульс", text: "15% шанс оглушить врага на 1 ход." }]
            : [{ name: "Блок", text: "Первый открытый навык, снижает урон в ход на 60%." }];
    document.getElementById("skillList").innerHTML = skills.map(s => `<div class='card'><strong>${s.name}</strong><div class='small'>${s.text}</div></div>`).join("");
}

function findItemById(id) { return [...gameState.inventory, ...gameState.chest].find(i => i.id === id); }

function renderEquipment() {
    const slots = ["head", "body", "right_hand", "left_hand", "legs", "gloves"];
    const map = { head: "Голова", body: "Тело", right_hand: "Правая рука", left_hand: "Левая рука", legs: "Ноги", gloves: "Перчатки" };
    document.getElementById("equipmentSlots").innerHTML = slots.map(slot => {
        const itemId = gameState.equipment[slot];
        const item = itemId ? findItemById(itemId) : null;
        return `<div class='slot'><div class='small'>${map[slot]}</div><strong>${item ? item.name : 'Пусто'}</strong></div>`;
    }).join("");
}

function equipItem(item) {
    const slot = item.equip_slot;
    if (!slot) return;
    if ((slot === "left_hand" || slot === "right_hand") && item.item_type !== "weapon") return toast("В руки можно экипировать только оружие");
    if (item.item_type === "weapon" && !(slot === "left_hand" || slot === "right_hand")) return;

    const prevId = gameState.equipment[slot];
    gameState.equipment[slot] = item.id;
    if (prevId && prevId !== item.id) {
        const prevIdx = gameState.chest.findIndex(i => i.id === prevId);
        if (prevIdx >= 0) gameState.inventory.push(gameState.chest.splice(prevIdx, 1)[0]);
    }
    renderEquipment();
    renderInventory();
    renderChest();
}

function useItem(item, storage) {
    if (item.heal_hp && gameState.player.current_hp >= gameState.player.max_hp) return toast("HP уже полное");
    if (item.heal_mana && gameState.player.current_mana >= gameState.player.max_mana) return toast("Мана уже полная");
    gameState.player.current_hp = Math.min(gameState.player.max_hp, gameState.player.current_hp + (item.heal_hp || 0));
    gameState.player.current_mana = Math.min(gameState.player.max_mana, gameState.player.current_mana + (item.heal_mana || 0));
    const arr = storage === "inventory" ? gameState.inventory : gameState.chest;
    const idx = arr.findIndex(i => i.id === item.id);
    if (idx >= 0) arr.splice(idx, 1);
    renderPlayerBars(); renderInventory(); renderChest();
}

function startBattle(monsterId) {
    const monster = (gameState.monsters[gameState.player.current_location] || []).find(m => m.id === monsterId);
    if (!monster) return;
    gameState.battle = { monster: { ...monster, currentHp: monster.hp, stunned: false }, turnTime: 10, locked: false, logs: [] };
    document.getElementById("battleOverlay").classList.add("open");
    runTurn();
}

function runTurn() {
    const b = gameState.battle;
    if (!b) return;
    b.locked = false;
    b.turnTime = 10;
    updateBattleUi();

    b.turnTick = setInterval(() => {
        b.turnTime -= 1;
        updateBattleUi();
        if (b.turnTime <= 0) endTurn();
    }, 1000);

    b.monsterHitTimeout = setTimeout(() => {
        if (b.monster.stunned) {
            b.logs.push("Монстр оглушен и пропускает атаку.");
            b.monster.stunned = false;
            updateBattleUi();
            return;
        }
        const dmg = rand(b.monster.minDamage, b.monster.maxDamage);
        gameState.player.current_hp = Math.max(0, gameState.player.current_hp - dmg);
        b.logs.push(`Монстр наносит ${dmg} урона.`);
        updateBattleUi();
        if (gameState.player.current_hp <= 0) finishBattle(false);
    }, rand(2, 7) * 1000);
}

function battleAction(action) {
    const b = gameState.battle;
    if (!b || b.locked) return;
    b.locked = true;

    if (action === "attack") {
        let dmg = rand(gameState.player.base_damage_min, gameState.player.base_damage_max);
        if (gameState.user.class_code === "archer" && chance(10)) { dmg *= 2; b.logs.push("Критический выстрел! x2 урон"); }
        b.monster.currentHp = Math.max(0, b.monster.currentHp - dmg);
        b.logs.push(`Вы нанесли ${dmg} урона.`);
    } else if (action === "skill") {
        if (gameState.user.class_code === "mage") {
            b.monster.currentHp = Math.max(0, b.monster.currentHp - 5);
            if (chance(15)) { b.monster.stunned = true; b.logs.push("Оглушение сработало!"); }
            b.logs.push("Магический импульс: 5 урона.");
        } else if (gameState.user.class_code === "orc") {
            b.logs.push("Блок активирован: входящий урон будет ниже в этот ход.");
        } else {
            b.logs.push("Навык лучника: при автоатаке работает шанс крита.");
        }
    } else {
        b.logs.push("Вы выжидаете момент...");
    }

    updateBattleUi();
    if (b.monster.currentHp <= 0) finishBattle(true);
}

function endTurn() {
    const b = gameState.battle;
    if (!b) return;
    clearInterval(b.turnTick);
    clearTimeout(b.monsterHitTimeout);
    if (b.monster.currentHp <= 0 || gameState.player.current_hp <= 0) return;
    runTurn();
}

function addLoot(monster) {
    monster.loot.forEach(l => {
        if (chance(l.chance)) {
            gameState.inventory.push({
                id: Date.now() + Math.floor(Math.random() * 10000),
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
                description: l.description || ""
            });
            gameState.battle.logs.push(`Выпал лут: ${l.name}`);
        }
    });
}

function finishBattle(win) {
    const b = gameState.battle;
    if (!b) return;
    clearInterval(b.turnTick);
    clearTimeout(b.monsterHitTimeout);

    if (win) {
        b.logs.push("Победа! Монстр будет восстановлен через 10 сек.");
        gameState.respawns[b.monster.id] = Date.now() + 10000;
        addLoot(b.monster);
    } else {
        b.logs.push("Поражение. HP/мана остаются в текущем состоянии.");
    }

    updateBattleUi();
    setTimeout(() => {
        document.getElementById("battleOverlay").classList.remove("open");
        gameState.battle = null;
        renderAll();
        setTimeout(renderMonsters, 10000);
    }, 1500);
}

function updateBattleUi() {
    const b = gameState.battle;
    if (!b) return;
    document.getElementById("battleTitle").textContent = `Бой против: ${b.monster.name}`;
    document.getElementById("battlePlayerHp").textContent = `${gameState.player.current_hp}/${gameState.player.max_hp}`;
    document.getElementById("battleMonsterHp").textContent = `${b.monster.currentHp}/${b.monster.hp}`;
    document.getElementById("battleTimer").textContent = b.turnTime;
    document.getElementById("battlePlayerBar").style.width = `${(gameState.player.current_hp / gameState.player.max_hp) * 100}%`;
    document.getElementById("battleMonsterBar").style.width = `${(b.monster.currentHp / b.monster.hp) * 100}%`;
    document.getElementById("battleLog").innerHTML = b.logs.map(l => `<div>• ${l}</div>`).join("");
    renderPlayerBars();
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
    list.innerHTML = data.users.map(u => `<div class='card'><b>${u.username}</b><div class='small'>${u.role} | ${u.class_code}</div><button class='btn warn' onclick='toggleBlock(${u.id})'>${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button></div>`).join('');
}

async function toggleBlock(userId) {
    await fetch('/api/admin/toggle-block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
    loadUsers();
}
