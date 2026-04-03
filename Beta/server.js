const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = 3000;
const db = new sqlite3.Database(path.join(__dirname, "database.db"));

app.use(express.json());
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
        return {
            max_hp: 85,
            current_hp: 85,
            max_mana: 30,
            current_mana: 30,
            base_damage_min: 5,
            base_damage_max: 10,
            crit_chance: 10,
            stun_chance: 0,
            has_block_skill: 0
        };
    }

    if (classCode === "mage") {
        return {
            max_hp: 75,
            current_hp: 75,
            max_mana: 70,
            current_mana: 70,
            base_damage_min: 5,
            base_damage_max: 5,
            crit_chance: 0,
            stun_chance: 15,
            has_block_skill: 0
        };
    }

    return {
        max_hp: 125,
        current_hp: 125,
        max_mana: 20,
        current_mana: 20,
        base_damage_min: 5,
        base_damage_max: 7,
        crit_chance: 0,
        stun_chance: 0,
        has_block_skill: 1
    };
}



function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Недостаточно прав" });
    }
    next();
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Сначала войдите в аккаунт" });
    }
    next();
}

async function ensureColumn(tableName, columnName, alterSql) {
    const cols = await all(`PRAGMA table_info(${tableName})`);
    const exists = cols.some(c => c.name === columnName);
    if (!exists) {
        await run(alterSql);
    }
}

async function ensureEquipmentSlots(userId) {
    const slots = ["head", "body", "right_hand", "left_hand", "legs", "gloves"];
    for (const slot of slots) {
        await run(
            `INSERT OR IGNORE INTO equipment (user_id, slot_code, item_id) VALUES (?, ?, NULL)`,
            [userId, slot]
        );
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

    if (classCode === "archer") {
        starterItems.push(["Деревянный лук", "weapon", "right_hand", 2, 4, 0, 0, 0, 3, "Простой лук для начинающего стрелка."]);
    } else if (classCode === "mage") {
        starterItems.push(["Учебный посох", "weapon", "right_hand", 1, 3, 0, 0, 0, 2, "Легкий посох для первых магических практик."]);
        starterItems.push(["Капля маны", "consumable", null, 0, 0, 0, 0, 20, 1, "Небольшое восстановление маны."]);
    } else {
        starterItems.push(["Тяжелая дубина", "weapon", "right_hand", 3, 5, 0, 0, 0, 5, "Грубое, но мощное оружие орка."]);
    }

    for (const item of starterItems) {
        const found = await get(
            `SELECT * FROM inventory_items WHERE user_id = ? AND name = ?`,
            [userId, item[0]]
        );
        if (!found) {
            await run(`
                INSERT INTO inventory_items
                (user_id, name, item_type, equip_slot, min_damage, max_damage, armor, heal_hp, heal_mana, weight, description, storage, quantity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inventory', 1)
            `, [userId, ...item]);
        }
    }
}

async function initDb() {
    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'player',
            class_code TEXT NOT NULL DEFAULT 'archer',
            is_blocked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS player_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            current_location TEXT NOT NULL DEFAULT 'street_lanterns',
            max_hp INTEGER NOT NULL DEFAULT 85,
            current_hp INTEGER NOT NULL DEFAULT 85,
            max_mana INTEGER NOT NULL DEFAULT 30,
            current_mana INTEGER NOT NULL DEFAULT 30,
            base_damage_min INTEGER NOT NULL DEFAULT 5,
            base_damage_max INTEGER NOT NULL DEFAULT 10,
            crit_chance REAL NOT NULL DEFAULT 10,
            stun_chance REAL NOT NULL DEFAULT 0,
            has_block_skill INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS equipment (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            slot_code TEXT NOT NULL,
            item_id INTEGER,
            UNIQUE(user_id, slot_code)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            item_type TEXT NOT NULL,
            equip_slot TEXT,
            min_damage INTEGER NOT NULL DEFAULT 0,
            max_damage INTEGER NOT NULL DEFAULT 0,
            armor INTEGER NOT NULL DEFAULT 0,
            heal_hp INTEGER NOT NULL DEFAULT 0,
            heal_mana INTEGER NOT NULL DEFAULT 0,
            weight INTEGER NOT NULL DEFAULT 1,
            description TEXT NOT NULL DEFAULT '',
            storage TEXT NOT NULL DEFAULT 'inventory',
            quantity INTEGER NOT NULL DEFAULT 1
        )
    `);

    await ensureColumn("users", "class_code", `ALTER TABLE users ADD COLUMN class_code TEXT NOT NULL DEFAULT 'archer'`);
    await ensureColumn("users", "is_blocked", `ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`);
    await ensureColumn("users", "role", `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'`);

    const users = await all(`SELECT * FROM users`);

    for (const user of users) {
        let classCode = user.class_code || "archer";
        if (!["archer", "mage", "orc"].includes(classCode)) classCode = "archer";

        const role = user.username === "Gihido" ? "admin" : (user.role || "player");

        await run(`UPDATE users SET class_code = ?, role = ? WHERE id = ?`, [classCode, role, user.id]);

        const existingPlayer = await get(`SELECT * FROM player_data WHERE user_id = ?`, [user.id]);

        if (!existingPlayer) {
            const preset = classPreset(classCode);
            await run(`
                INSERT INTO player_data
                (user_id, current_location, max_hp, current_hp, max_mana, current_mana, base_damage_min, base_damage_max, crit_chance, stun_chance, has_block_skill)
                VALUES (?, 'street_lanterns', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                user.id,
                preset.max_hp,
                preset.current_hp,
                preset.max_mana,
                preset.current_mana,
                preset.base_damage_min,
                preset.base_damage_max,
                preset.crit_chance,
                preset.stun_chance,
                preset.has_block_skill
            ]);
        }

        await ensureEquipmentSlots(user.id);
        await giveStarterItems(user.id, classCode);
    }

    console.log("База данных и миграция готовы.");
}

app.post("/api/register", async (req, res) => {
    try {
        const { username, password, classCode } = req.body;

        if (!username || !password || !classCode) {
            return res.json({ success: false, message: "Заполните все поля" });
        }

        if (!["archer", "mage", "orc"].includes(classCode)) {
            return res.json({ success: false, message: "Неверный класс" });
        }

        const exists = await get(`SELECT * FROM users WHERE username = ?`, [username]);
        if (exists) {
            return res.json({ success: false, message: "Такой логин уже существует" });
        }

        const hashed = await bcrypt.hash(password, 10);
        const role = username === "Gihido" ? "admin" : "player";

        const inserted = await run(`
            INSERT INTO users (username, password, role, class_code)
            VALUES (?, ?, ?, ?)
        `, [username, hashed, role, classCode]);

        const preset = classPreset(classCode);

        await run(`
            INSERT INTO player_data
            (user_id, current_location, max_hp, current_hp, max_mana, current_mana, base_damage_min, base_damage_max, crit_chance, stun_chance, has_block_skill)
            VALUES (?, 'street_lanterns', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            inserted.lastID,
            preset.max_hp,
            preset.current_hp,
            preset.max_mana,
            preset.current_mana,
            preset.base_damage_min,
            preset.base_damage_max,
            preset.crit_chance,
            preset.stun_chance,
            preset.has_block_skill
        ]);

        await ensureEquipmentSlots(inserted.lastID);
        await giveStarterItems(inserted.lastID, classCode);

        res.json({ success: true, message: "Регистрация успешна" });
    } catch (e) {
        res.json({ success: false, message: "Ошибка регистрации" });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
        if (!user) {
            return res.json({ success: false, message: "Пользователь не найден" });
        }

        if (user.is_blocked) {
            return res.json({ success: false, message: "Аккаунт заблокирован" });
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            return res.json({ success: false, message: "Неверный пароль" });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            class_code: user.class_code
        };

        res.json({
            success: true,
            message: "Вход выполнен",
            user: req.session.user
        });
    } catch {
        res.json({ success: false, message: "Ошибка входа" });
    }
});

app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/game-data", requireAuth, async (req, res) => {
    try {
        const user = await get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id]);
        const player = await get(`SELECT * FROM player_data WHERE user_id = ?`, [req.session.user.id]);
        const inventory = await all(`SELECT * FROM inventory_items WHERE user_id = ? AND storage = 'inventory' ORDER BY id DESC`, [req.session.user.id]);
        const chest = await all(`SELECT * FROM inventory_items WHERE user_id = ? AND storage = 'chest' ORDER BY id DESC`, [req.session.user.id]);
        const equipment = await all(`SELECT * FROM equipment WHERE user_id = ? ORDER BY id ASC`, [req.session.user.id]);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    class_code: user.class_code,
                    class_label: classLabel(user.class_code)
                },
                player,
                inventory,
                chest,
                equipment
            }
        });
    } catch {
        res.json({ success: false, message: "Ошибка загрузки данных" });
    }
});



app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await all(`SELECT id, username, role, class_code, is_blocked FROM users ORDER BY id DESC`);
        res.json({ success: true, users });
    } catch {
        res.json({ success: false, message: "Ошибка загрузки" });
    }
});

app.post("/api/admin/toggle-block", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await get(`SELECT id, is_blocked FROM users WHERE id = ?`, [userId]);
        if (!user) return res.json({ success: false, message: "Игрок не найден" });
        const nextValue = user.is_blocked ? 0 : 1;
        await run(`UPDATE users SET is_blocked = ? WHERE id = ?`, [nextValue, userId]);
        res.json({ success: true, message: nextValue ? "Игрок заблокирован" : "Игрок разблокирован" });
    } catch {
        res.json({ success: false, message: "Ошибка изменения" });
    }
});

initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Сервер запущен: http://localhost:${PORT}`);
    });
});