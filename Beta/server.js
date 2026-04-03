const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = 3000;
const db = new sqlite3.Database(path.join(__dirname, "database.db"));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: "text_rpg_secret_key",
    resave: false,
    saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, "Public")));

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function classLabel(classCode) {
    if (classCode === "mage") return "Маг";
    if (classCode === "orc") return "Орк";
    return "Лучник";
}

function classPreset(classCode) {
    if (classCode === "archer") {
        return { max_hp: 85, current_hp: 85, max_mana: 30, current_mana: 30, base_damage_min: 5, base_damage_max: 10, crit_chance: 10, stun_chance: 0, has_block_skill: 0 };
    }
    if (classCode === "mage") {
        return { max_hp: 75, current_hp: 75, max_mana: 70, current_mana: 70, base_damage_min: 5, base_damage_max: 5, crit_chance: 0, stun_chance: 15, has_block_skill: 0 };
    }
    return { max_hp: 125, current_hp: 125, max_mana: 20, current_mana: 20, base_damage_min: 5, base_damage_max: 7, crit_chance: 0, stun_chance: 0, has_block_skill: 1 };
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Сначала войдите в аккаунт" });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Недостаточно прав" });
    }
    next();
}

async function ensureColumn(tableName, columnName, alterSql) {
    const cols = await all(`PRAGMA table_info(${tableName})`);
    if (!cols.some(c => c.name === columnName)) await run(alterSql);
}

async function ensureEquipmentSlots(userId) {
    const slots = ["head", "body", "right_hand", "left_hand", "legs", "gloves"];
    for (const slot of slots) {
        await run(`INSERT OR IGNORE INTO equipment (user_id, slot_code, item_id) VALUES (?, ?, NULL)`, [userId, slot]);
    }
}

async function giveStarterItems(userId, classCode) {
    const starterItems = [
        ["Яблоко", "consumable", null, 0, 0, 0, 20, 0, 1, "Простое яблоко. Восстанавливает здоровье."],
        ["Старый ключ", "misc", null, 0, 0, 0, 0, 0, 1, "Старый ключ. Пока непонятно, от чего он."],
        ["Тканевая шапка", "armor", "head", 0, 0, 2, 0, 0, 1, "Легкая защита для головы."],
        ["Простая куртка", "armor", "body", 0, 0, 3, 0, 0, 2, "Простая защита тела."],
        ["Походные сапоги", "armor", "legs", 0, 0, 2, 0, 0, 2, "Подходят для долгих переходов."]
    ];

    if (classCode === "archer") starterItems.push(["Деревянный лук", "weapon", "right_hand", 2, 4, 0, 0, 0, 3, "Простой лук для начинающего стрелка."]);
    if (classCode === "mage") {
        starterItems.push(["Учебный посох", "weapon", "right_hand", 1, 3, 0, 0, 0, 2, "Легкий посох для первых магических практик."]);
        starterItems.push(["Капля маны", "consumable", null, 0, 0, 0, 0, 20, 1, "Небольшое восстановление маны."]);
    }
    if (classCode === "orc") starterItems.push(["Тяжелая дубина", "weapon", "right_hand", 3, 5, 0, 0, 0, 5, "Грубое, но мощное оружие орка."]);

    for (const item of starterItems) {
        const found = await get(`SELECT * FROM inventory_items WHERE user_id = ? AND name = ?`, [userId, item[0]]);
        if (!found) {
            await run(`
                INSERT INTO inventory_items
                (user_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, storage, quantity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inventory', 1)
            `, [userId, ...item]);
        }
    }
}

async function ensureSkill(userId, code, name, description, classCode) {
    const row = await get(`SELECT id FROM skills WHERE code = ?`, [code]);
    const skillId = row ? row.id : (await run(`INSERT INTO skills (code, name, description, class_code, power, mana_cost, effect_type, effect_chance) VALUES (?, ?, ?, ?, 0, 0, 'none', 0)`, [code, name, description, classCode])).lastID;
    await run(`INSERT OR IGNORE INTO user_skills (user_id, skill_id, is_equipped) VALUES (?, ?, 1)`, [userId, skillId]);
}

async function seedWorld() {
    const locations = await all(`SELECT * FROM locations`);
    if (!locations.length) {
        await run(`INSERT INTO locations (code, name, description, image_url, next_code, prev_code) VALUES
        ('street_lanterns','Первая улица','Безопасный старт. Только здесь доступен сундук.','https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1200&auto=format&fit=crop','old_square',NULL),
        ('old_square','Старая площадь','Площадь с развалинами и патрулями нечисти.','https://images.unsplash.com/photo-1529429611273-7bbec85f5e5c?q=80&w=1200&auto=format&fit=crop','dark_gate','street_lanterns'),
        ('dark_gate','Тёмные ворота','Опасная зона с сильными врагами.','https://images.unsplash.com/photo-1472396961693-142e6e269027?q=80&w=1200&auto=format&fit=crop',NULL,'old_square')`);
    }

    const monsters = await all(`SELECT * FROM monsters`);
    if (!monsters.length) {
        await run(`INSERT INTO monsters (code, location_code, name, hp, min_damage, max_damage, image_url) VALUES
        ('rat','street_lanterns','Гигантская крыса',45,2,5,'https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?q=80&w=1200&auto=format&fit=crop'),
        ('skeleton','old_square','Скелет-воин',78,5,9,'https://images.unsplash.com/photo-1638828844123-4517ad0cf90e?q=80&w=1200&auto=format&fit=crop'),
        ('ogre','dark_gate','Огр-хранитель',110,6,12,'https://images.unsplash.com/photo-1518709268805-4e9042af2176?q=80&w=1200&auto=format&fit=crop')`);

        const ratId = (await get(`SELECT id FROM monsters WHERE code='rat'`)).id;
        const skeletonId = (await get(`SELECT id FROM monsters WHERE code='skeleton'`)).id;
        const ogreId = (await get(`SELECT id FROM monsters WHERE code='ogre'`)).id;

        await run(`INSERT INTO monster_loot (monster_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, chance) VALUES
        (?, 'Ржавый кинжал', 'weapon', 'right_hand', 3, 6, 0, 0, 0, 2, 'Старый кинжал.', 18),
        (?, 'Латные перчатки', 'armor', 'gloves', 0, 0, 4, 0, 0, 3, 'Прочная защита рук.', 20),
        (?, 'Большое зелье HP', 'consumable', NULL, 0, 0, 0, 35, 0, 2, 'Сильное восстановление.', 30)
        `, [ratId, skeletonId, ogreId]);
    }

    const skills = await all(`SELECT * FROM skills`);
    if (!skills.length) {
        await run(`INSERT INTO skills (code, name, description, class_code, power, mana_cost, effect_type, effect_chance) VALUES
        ('archer_focus','Точный выстрел','10% шанс нанести двойной урон.','archer',0,0,'crit_boost',10),
        ('mage_impulse','Магический импульс','5 урона и 15% шанс оглушить на 1 ход.','mage',5,10,'stun',15),
        ('orc_block','Блок','Снижает урон следующей атаки монстра.','orc',0,0,'block',100)`);
    }
}

async function initDb() {
    await run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', class_code TEXT NOT NULL DEFAULT 'archer', is_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS player_data (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, current_location TEXT NOT NULL DEFAULT 'street_lanterns', max_hp INTEGER NOT NULL DEFAULT 85, current_hp INTEGER NOT NULL DEFAULT 85, max_mana INTEGER NOT NULL DEFAULT 30, current_mana INTEGER NOT NULL DEFAULT 30, base_damage_min INTEGER NOT NULL DEFAULT 5, base_damage_max INTEGER NOT NULL DEFAULT 10, crit_chance REAL NOT NULL DEFAULT 10, stun_chance REAL NOT NULL DEFAULT 0, has_block_skill INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id))`);
    await run(`CREATE TABLE IF NOT EXISTS equipment (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, slot_code TEXT NOT NULL, item_id INTEGER, UNIQUE(user_id, slot_code))`);
    await run(`CREATE TABLE IF NOT EXISTS inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, item_type TEXT NOT NULL, equip_slot TEXT, min_damage INTEGER NOT NULL DEFAULT 0, max_damage INTEGER NOT NULL DEFAULT 0, armor INTEGER NOT NULL DEFAULT 0, heal_hp INTEGER NOT NULL DEFAULT 0, heal_mana INTEGER NOT NULL DEFAULT 0, weight INTEGER NOT NULL DEFAULT 1, description TEXT NOT NULL DEFAULT '', storage TEXT NOT NULL DEFAULT 'inventory', quantity INTEGER NOT NULL DEFAULT 1)`);
    await run(`CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, image_url TEXT NOT NULL, next_code TEXT, prev_code TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS monsters (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, location_code TEXT NOT NULL, name TEXT NOT NULL, hp INTEGER NOT NULL, min_damage INTEGER NOT NULL, max_damage INTEGER NOT NULL, image_url TEXT NOT NULL)`);
    await run(`CREATE TABLE IF NOT EXISTS monster_loot (id INTEGER PRIMARY KEY AUTOINCREMENT, monster_id INTEGER NOT NULL, name TEXT NOT NULL, item_type TEXT NOT NULL, equip_slot TEXT, min_damage INTEGER DEFAULT 0, max_damage INTEGER DEFAULT 0, armor INTEGER DEFAULT 0, heal_hp INTEGER DEFAULT 0, heal_mana INTEGER DEFAULT 0, weight INTEGER DEFAULT 1, description TEXT DEFAULT '', chance REAL NOT NULL DEFAULT 10)`);
    await run(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, class_code TEXT NOT NULL DEFAULT 'archer', power INTEGER NOT NULL DEFAULT 0, mana_cost INTEGER NOT NULL DEFAULT 0, effect_type TEXT NOT NULL DEFAULT 'none', effect_chance REAL NOT NULL DEFAULT 0)`);
    await run(`CREATE TABLE IF NOT EXISTS user_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, skill_id INTEGER NOT NULL, is_equipped INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, skill_id))`);
    await run(`CREATE TABLE IF NOT EXISTS item_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, item_type TEXT NOT NULL, equip_slot TEXT, min_damage INTEGER DEFAULT 0, max_damage INTEGER DEFAULT 0, armor INTEGER DEFAULT 0, heal_hp INTEGER DEFAULT 0, heal_mana INTEGER DEFAULT 0, weight INTEGER DEFAULT 1, description TEXT DEFAULT '')`);

    await ensureColumn("users", "class_code", `ALTER TABLE users ADD COLUMN class_code TEXT NOT NULL DEFAULT 'archer'`);
    await ensureColumn("users", "is_blocked", `ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`);
    await ensureColumn("users", "role", `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'`);

    await seedWorld();

    const users = await all(`SELECT * FROM users`);
    for (const user of users) {
        const classCode = ["archer", "mage", "orc"].includes(user.class_code) ? user.class_code : "archer";
        const role = user.username === "Gihido" ? "admin" : (user.role || "player");
        await run(`UPDATE users SET class_code = ?, role = ? WHERE id = ?`, [classCode, role, user.id]);
        const existingPlayer = await get(`SELECT * FROM player_data WHERE user_id = ?`, [user.id]);
        if (!existingPlayer) {
            const p = classPreset(classCode);
            await run(`INSERT INTO player_data (user_id, current_location, max_hp, current_hp, max_mana, current_mana, base_damage_min, base_damage_max, crit_chance, stun_chance, has_block_skill) VALUES (?, 'street_lanterns', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [user.id, p.max_hp, p.current_hp, p.max_mana, p.current_mana, p.base_damage_min, p.base_damage_max, p.crit_chance, p.stun_chance, p.has_block_skill]);
        }
        await ensureEquipmentSlots(user.id);
        await giveStarterItems(user.id, classCode);
        if (classCode === "archer") await ensureSkill(user.id, "archer_focus", "Точный выстрел", "10% шанс нанести двойной урон.", "archer");
        if (classCode === "mage") await ensureSkill(user.id, "mage_impulse", "Магический импульс", "5 урона и 15% шанс оглушить.", "mage");
        if (classCode === "orc") await ensureSkill(user.id, "orc_block", "Блок", "Снижает урон следующей атаки монстра.", "orc");
    }

    console.log("База данных и миграция готовы.");
}

app.post("/api/register", async (req, res) => {
    try {
        const { username, password, classCode } = req.body;
        if (!username || !password || !classCode) return res.json({ success: false, message: "Заполните все поля" });
        if (!["archer", "mage", "orc"].includes(classCode)) return res.json({ success: false, message: "Неверный класс" });
        const exists = await get(`SELECT * FROM users WHERE username = ?`, [username]);
        if (exists) return res.json({ success: false, message: "Такой логин уже существует" });

        const hashed = await bcrypt.hash(password, 10);
        const role = username === "Gihido" ? "admin" : "player";
        const inserted = await run(`INSERT INTO users (username, password, role, class_code) VALUES (?, ?, ?, ?)`, [username, hashed, role, classCode]);
        const p = classPreset(classCode);
        await run(`INSERT INTO player_data (user_id, current_location, max_hp, current_hp, max_mana, current_mana, base_damage_min, base_damage_max, crit_chance, stun_chance, has_block_skill) VALUES (?, 'street_lanterns', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [inserted.lastID, p.max_hp, p.current_hp, p.max_mana, p.current_mana, p.base_damage_min, p.base_damage_max, p.crit_chance, p.stun_chance, p.has_block_skill]);
        await ensureEquipmentSlots(inserted.lastID);
        await giveStarterItems(inserted.lastID, classCode);
        if (classCode === "archer") await ensureSkill(inserted.lastID, "archer_focus", "Точный выстрел", "10% шанс нанести двойной урон.", "archer");
        if (classCode === "mage") await ensureSkill(inserted.lastID, "mage_impulse", "Магический импульс", "5 урона и 15% шанс оглушить.", "mage");
        if (classCode === "orc") await ensureSkill(inserted.lastID, "orc_block", "Блок", "Снижает урон следующей атаки монстра.", "orc");
        res.json({ success: true, message: "Регистрация успешна" });
    } catch {
        res.json({ success: false, message: "Ошибка регистрации" });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
        if (!user) return res.json({ success: false, message: "Пользователь не найден" });
        if (user.is_blocked) return res.json({ success: false, message: "Аккаунт заблокирован" });
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.json({ success: false, message: "Неверный пароль" });

        req.session.user = { id: user.id, username: user.username, role: user.role, class_code: user.class_code };
        res.json({ success: true, message: "Вход выполнен", user: req.session.user });
    } catch {
        res.json({ success: false, message: "Ошибка входа" });
    }
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get("/api/game-data", requireAuth, async (req, res) => {
    try {
        const user = await get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id]);
        const player = await get(`SELECT * FROM player_data WHERE user_id = ?`, [req.session.user.id]);
        const inventory = await all(`SELECT * FROM inventory_items WHERE user_id = ? AND storage = 'inventory' ORDER BY id DESC`, [req.session.user.id]);
        const chest = await all(`SELECT * FROM inventory_items WHERE user_id = ? AND storage = 'chest' ORDER BY id DESC`, [req.session.user.id]);
        const equipment = await all(`SELECT * FROM equipment WHERE user_id = ? ORDER BY id ASC`, [req.session.user.id]);
        const locations = await all(`SELECT code, name, description, image_url, next_code as next, prev_code as prev FROM locations ORDER BY id ASC`);
        const monstersRaw = await all(`SELECT * FROM monsters ORDER BY id ASC`);
        const lootRows = await all(`SELECT * FROM monster_loot ORDER BY id ASC`);
        const lootByMonster = lootRows.reduce((a, x) => {
            if (!a[x.monster_id]) a[x.monster_id] = [];
            a[x.monster_id].push(x);
            return a;
        }, {});
        const monsters = monstersRaw.map(m => ({
            id: m.code,
            name: m.name,
            hp: m.hp,
            minDamage: m.min_damage,
            maxDamage: m.max_damage,
            image: m.image_url,
            location_code: m.location_code,
            loot: (lootByMonster[m.id] || []).map(l => ({
                name: l.name,
                type: l.item_type,
                equip_slot: l.equip_slot,
                min_damage: l.min_damage,
                max_damage: l.max_damage,
                armor: l.armor,
                heal_hp: l.heal_hp,
                heal_mana: l.heal_mana,
                weight: l.weight,
                description: l.description,
                chance: l.chance
            }))
        }));
        const userSkills = await all(`
            SELECT us.id as user_skill_id, us.is_equipped, s.*
            FROM user_skills us
            JOIN skills s ON s.id = us.skill_id
            WHERE us.user_id = ?
            ORDER BY s.id ASC
        `, [req.session.user.id]);

        res.json({
            success: true,
            data: {
                user: { id: user.id, username: user.username, role: user.role, class_code: user.class_code, class_label: classLabel(user.class_code) },
                player,
                inventory,
                chest,
                equipment,
                locations,
                monsters,
                skills: userSkills
            }
        });
    } catch {
        res.json({ success: false, message: "Ошибка загрузки данных" });
    }
});

app.post("/api/player-state", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { player, inventory = [], chest = [], equipped = {}, skills = [] } = req.body;

        await run(`UPDATE player_data SET current_hp = ?, current_mana = ?, current_location = ? WHERE user_id = ?`, [
            Number(player?.current_hp) || 1,
            Number(player?.current_mana) || 0,
            player?.current_location || "street_lanterns",
            userId
        ]);

        const allItemsIncoming = [
            ...inventory.map(i => ({ ...i, storage: "inventory" })),
            ...chest.map(i => ({ ...i, storage: "chest" })),
            ...Object.values(equipped || {}).filter(Boolean).map(i => ({ ...i, storage: "inventory" }))
        ];

        const existingRows = await all(`SELECT * FROM inventory_items WHERE user_id = ?`, [userId]);
        const existingMap = new Map(existingRows.map(r => [r.id, r]));
        const keptIds = new Set();
        const sigToId = new Map();

        function signature(item) {
            return [item.name, item.item_type, item.equip_slot || "", item.min_damage || 0, item.max_damage || 0, item.armor || 0, item.heal_hp || 0, item.heal_mana || 0, item.weight || 0, item.description || ""].join("|");
        }

        for (const item of allItemsIncoming) {
            if (item && Number.isInteger(item.id) && existingMap.has(item.id)) {
                await run(`UPDATE inventory_items SET name=?, item_type=?, equip_slot=?, min_damage=?, max_damage=?, armor=?, heal_hp=?, heal_mana=?, weight=?, description=?, storage=? WHERE id=? AND user_id=?`, [
                    item.name,
                    item.item_type,
                    item.equip_slot || null,
                    Number(item.min_damage) || 0,
                    Number(item.max_damage) || 0,
                    Number(item.armor) || 0,
                    Number(item.heal_hp) || 0,
                    Number(item.heal_mana) || 0,
                    Number(item.weight) || 1,
                    item.description || "",
                    item.storage,
                    item.id,
                    userId
                ]);
                keptIds.add(item.id);
                sigToId.set(signature(item), item.id);
            } else {
                const inserted = await run(`INSERT INTO inventory_items (user_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, storage, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
                    userId,
                    item.name,
                    item.item_type,
                    item.equip_slot || null,
                    Number(item.min_damage) || 0,
                    Number(item.max_damage) || 0,
                    Number(item.armor) || 0,
                    Number(item.heal_hp) || 0,
                    Number(item.heal_mana) || 0,
                    Number(item.weight) || 1,
                    item.description || "",
                    item.storage || "inventory"
                ]);
                keptIds.add(inserted.lastID);
                sigToId.set(signature(item), inserted.lastID);
            }
        }

        for (const row of existingRows) {
            if (!keptIds.has(row.id)) await run(`DELETE FROM inventory_items WHERE id = ? AND user_id = ?`, [row.id, userId]);
        }

        const slots = ["head", "body", "right_hand", "left_hand", "legs", "gloves"];
        for (const slot of slots) {
            const eqItem = equipped?.[slot];
            let itemId = null;
            if (eqItem) {
                if (Number.isInteger(eqItem.id) && keptIds.has(eqItem.id)) itemId = eqItem.id;
                else itemId = sigToId.get(signature(eqItem)) || null;
            }
            await run(`UPDATE equipment SET item_id = ? WHERE user_id = ? AND slot_code = ?`, [itemId, userId, slot]);
        }

        for (const s of skills || []) {
            await run(`UPDATE user_skills SET is_equipped = ? WHERE id = ? AND user_id = ?`, [s.is_equipped ? 1 : 0, s.user_skill_id, userId]);
        }

        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: "Ошибка сохранения" });
    }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    const users = await all(`SELECT id, username, role, class_code, is_blocked FROM users ORDER BY id DESC`);
    res.json({ success: true, users });
});

app.post("/api/admin/toggle-block", requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const user = await get(`SELECT id, is_blocked FROM users WHERE id = ?`, [userId]);
    if (!user) return res.json({ success: false, message: "Игрок не найден" });
    const next = user.is_blocked ? 0 : 1;
    await run(`UPDATE users SET is_blocked = ? WHERE id = ?`, [next, userId]);
    res.json({ success: true });
});

app.get("/api/admin/locations", requireAuth, requireAdmin, async (req, res) => res.json({ success: true, locations: await all(`SELECT * FROM locations ORDER BY id ASC`) }));
app.post("/api/admin/locations", requireAuth, requireAdmin, async (req, res) => {
    const { code, name, description, image_url, next_code, prev_code } = req.body;
    await run(`INSERT INTO locations (code, name, description, image_url, next_code, prev_code) VALUES (?, ?, ?, ?, ?, ?)`, [code, name, description, image_url, next_code || null, prev_code || null]);
    res.json({ success: true });
});
app.put("/api/admin/locations/:id", requireAuth, requireAdmin, async (req, res) => {
    const { code, name, description, image_url, next_code, prev_code } = req.body;
    await run(`UPDATE locations SET code=?, name=?, description=?, image_url=?, next_code=?, prev_code=? WHERE id=?`, [code, name, description, image_url, next_code || null, prev_code || null, req.params.id]);
    res.json({ success: true });
});

app.get("/api/admin/monsters", requireAuth, requireAdmin, async (req, res) => res.json({ success: true, monsters: await all(`SELECT * FROM monsters ORDER BY id ASC`) }));
app.post("/api/admin/monsters", requireAuth, requireAdmin, async (req, res) => {
    const { code, location_code, name, hp, min_damage, max_damage, image_url } = req.body;
    await run(`INSERT INTO monsters (code, location_code, name, hp, min_damage, max_damage, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`, [code, location_code, name, hp, min_damage, max_damage, image_url]);
    res.json({ success: true });
});
app.put("/api/admin/monsters/:id", requireAuth, requireAdmin, async (req, res) => {
    const { code, location_code, name, hp, min_damage, max_damage, image_url } = req.body;
    await run(`UPDATE monsters SET code=?, location_code=?, name=?, hp=?, min_damage=?, max_damage=?, image_url=? WHERE id=?`, [code, location_code, name, hp, min_damage, max_damage, image_url, req.params.id]);
    res.json({ success: true });
});

app.get("/api/admin/loot", requireAuth, requireAdmin, async (req, res) => res.json({ success: true, loot: await all(`SELECT ml.*, m.name as monster_name FROM monster_loot ml JOIN monsters m ON m.id=ml.monster_id ORDER BY ml.id ASC`) }));
app.post("/api/admin/loot", requireAuth, requireAdmin, async (req, res) => {
    const { monster_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, chance } = req.body;
    await run(`INSERT INTO monster_loot (monster_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, chance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [monster_id, name, item_type, equip_slot || null, min_damage || 0, max_damage || 0, armor || 0, heal_hp || 0, heal_mana || 0, weight || 1, description || "", chance || 10]);
    res.json({ success: true });
});
app.put("/api/admin/loot/:id", requireAuth, requireAdmin, async (req, res) => {
    const { monster_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, chance } = req.body;
    await run(`UPDATE monster_loot SET monster_id=?, name=?, item_type=?, equip_slot=?, min_damage=?, max_damage=?, armor=?, heal_hp=?, heal_mana=?, weight=?, description=?, chance=? WHERE id=?`, [monster_id, name, item_type, equip_slot || null, min_damage || 0, max_damage || 0, armor || 0, heal_hp || 0, heal_mana || 0, weight || 1, description || "", chance || 10, req.params.id]);
    res.json({ success: true });
});

app.get("/api/admin/skills", requireAuth, requireAdmin, async (req, res) => res.json({ success: true, skills: await all(`SELECT * FROM skills ORDER BY id ASC`) }));
app.post("/api/admin/skills", requireAuth, requireAdmin, async (req, res) => {
    const { code, name, description, class_code, power, mana_cost, effect_type, effect_chance } = req.body;
    await run(`INSERT INTO skills (code, name, description, class_code, power, mana_cost, effect_type, effect_chance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [code, name, description, class_code, power || 0, mana_cost || 0, effect_type || 'none', effect_chance || 0]);
    res.json({ success: true });
});

app.get("/api/admin/items", requireAuth, requireAdmin, async (req, res) => res.json({ success: true, items: await all(`SELECT * FROM item_templates ORDER BY id ASC`) }));
app.post("/api/admin/items", requireAuth, requireAdmin, async (req, res) => {
    const { name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description } = req.body;
    await run(`INSERT INTO item_templates (name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name, item_type, equip_slot || null, min_damage || 0, max_damage || 0, armor || 0, heal_hp || 0, heal_mana || 0, weight || 1, description || ""]);
    res.json({ success: true });
});

app.post("/api/admin/give-item", requireAuth, requireAdmin, async (req, res) => {
    const { userId, templateId, storage } = req.body;
    const tpl = await get(`SELECT * FROM item_templates WHERE id=?`, [templateId]);
    if (!tpl) return res.json({ success: false, message: "Шаблон не найден" });
    await run(`INSERT INTO inventory_items (user_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, storage, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
        userId,
        tpl.name,
        tpl.item_type,
        tpl.equip_slot,
        tpl.min_damage,
        tpl.max_damage,
        tpl.armor,
        tpl.heal_hp,
        tpl.heal_mana,
        tpl.weight,
        tpl.description,
        storage || "inventory"
    ]);
    res.json({ success: true });
});

app.post("/api/admin/grant-skill", requireAuth, requireAdmin, async (req, res) => {
    const { userId, skillId, is_equipped } = req.body;
    await run(`INSERT OR IGNORE INTO user_skills (user_id, skill_id, is_equipped) VALUES (?, ?, ?)`, [userId, skillId, is_equipped ? 1 : 0]);
    await run(`UPDATE user_skills SET is_equipped=? WHERE user_id=? AND skill_id=?`, [is_equipped ? 1 : 0, userId, skillId]);
    res.json({ success: true });
});

initDb().then(() => {
    app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
});
