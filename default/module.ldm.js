// Модуль Long Distance Mining - майним соседние комнаты.
// Основные функции:
// 1. Поиск новых комнат для LDM.
//    Проверка, что контроллер не занят
//    Проверка, что нет врагов
// 2. Создание дорог до минералов.

const configurations = {
    "miner":       [...Array(5).fill(WORK), ...Array( 1).fill(CARRY), ...Array( 3).fill(MOVE)],
    "transporter": [...Array(1).fill(WORK), ...Array(19).fill(CARRY), ...Array(10).fill(MOVE)],
    "claimer":     [...Array(1).fill(CLAIM),                          ...Array( 2).fill(MOVE)],
};

module.exports = {

};