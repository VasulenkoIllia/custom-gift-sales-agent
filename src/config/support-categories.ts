/**
 * support-categories.ts — Lightweight keyword-based category detection.
 *
 * Used to SOFT-BOOST same-category KB matches at retrieval time (never a hard
 * filter — a mis-detected category must never drop the correct answer).
 *
 * Detection is keyword-based (not an LLM call) because it runs on every inbound
 * message and an 8-way classification is well-served by Ukrainian trigger words.
 *
 * Categories mirror the KB taxonomy:
 *   connectivity | power | sensor | colors | physical | safety | app_account | meta | product
 */

export const SUPPORT_CATEGORY_KEYWORDS: Record<string, string[]> = {
    product: [
        "square", "сквер", "модель", "розмір лампи", "яка висота", "висота",
        "характеристик", "специфікац", "потужність", "світловий потік", "люмен",
        "вага", "комплект", "що в коробці", "ціна", "вартість", "скільки коштує",
        "габарит", "матеріал", "сертифікат", "ce",
    ],
    connectivity: [
        "не підключ", "підключ", "wi-fi", "wifi", "вай-фай", "вайфай", "вай фай",
        "блютуз", "bluetooth", "не бачить", "не знаходить", "5 ггц", "2.4", "2,4",
        "роутер", "мережа", "інтернет", "точка доступу", "пар", "сполуч",
    ],
    power: [
        "не вмикається", "не вимикається", "не включається", "не заряд", "заряд",
        "живлення", "акумулятор", "батаре", "адаптер", "блок живлення", "usb",
        "powerbank", "повербанк", "розряд", "вимикається сам", "перезавантаж",
        "кабель", "шнур", "вилка", "розетк",
    ],
    sensor: [
        "сенсор", "не реагує", "дотик", "тач", "touch", "кнопк", "натиск",
        "подвійний дотик", "double tap", "жест", "утриман",
    ],
    colors: [
        "колір", "кольор", "rgb", "не змінює колір", "білий", "теплий", "холодний",
        "яскрав", "тьмян", "ефект", "мерехт", "блима", "музичн", "режим світла",
        "відтінок", "підсвіт",
    ],
    physical: [
        "тріснул", "розбил", "корпус", "кріплення", "впала", "пошкодж", "зламав",
        "подряпин", "горизонтальн", "повісити", "встановити", "поставити",
        "монтаж", "ніжк", "підставк",
    ],
    safety: [
        "нагрів", "гаряч", "запах", "дим", "іскр", "вологість", "вода", "залив",
        "промокл", "ванн", "вулиц", "перегрів", "безпеч", "небезпеч", "пожеж",
        "тканин", "накрив",
    ],
    app_account: [
        "додаток", "застосунок", "аплікейшн", "app", "акаунт", "обліковий",
        "пароль", "увійти", "вхід", "логін", "реєстрац", "offline", "офлайн",
        "оновлення", "ota", "прошивк", "синхрон", "керування", "дистанц",
    ],
    meta: [
        "гарантія", "повернення", "повернути", "обмін", "доставка", "оплата",
        "ціна", "вартість", "інструкц", "менеджер", "оператор", "магазин",
        "замовлення", "чек",
    ],
};

/**
 * Returns the highest-scoring category for the text, or null when no keyword
 * fires (uncertain → no boost, full recall preserved). Score = number of
 * distinct matching keywords; ties resolved by first category in declaration order.
 */
export function detectCategory(text: string): string | null {
    const normalized = text.toLowerCase();
    let best: string | null = null;
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(SUPPORT_CATEGORY_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            if (normalized.includes(kw)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = category;
        }
    }

    return best;
}
