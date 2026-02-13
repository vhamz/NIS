// Import Transformers.js
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Google Sheets URL (замените на ваш актуальный URL после деплоя)
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzSQPmjdlHLTGFpPsacAiKevulk6X43vV4JOkMTzms0sRBPnVqNvlHg7jEHAKlD6oCq/exec';

let reviews = [];
let model = null;

const el = {
    status: document.getElementById('statusMessage'),
    error: document.getElementById('errorMessage'),
    btn: document.getElementById('analyzeButton'),
    review: document.getElementById('reviewText'),
    result: document.getElementById('resultBox'),
    icon: document.getElementById('resultIcon'),
    label: document.getElementById('resultLabel'),
    conf: document.getElementById('resultConfidence'),
    loading: document.getElementById('loadingSpinner'),
    // НОВЫЕ ЭЛЕМЕНТЫ
    actionBox: document.getElementById('actionBox'),
    actionMessage: document.getElementById('actionMessage'),
    actionButton: document.getElementById('actionButton')
};

function setStatus(text) {
    el.status.textContent = text;
}

function showError(text) {
    el.error.textContent = text;
    el.error.style.display = 'block';
}

function hideError() {
    el.error.style.display = 'none';
}

async function loadReviews() {
    const res = await fetch('reviews_test.tsv');
    const text = await res.text();
    
    return new Promise((resolve, reject) => {
        Papa.parse(text, {
            header: true,
            delimiter: '\t',
            complete: (r) => {
                const data = r.data.map(row => row.text).filter(t => t && t.trim());
                if (data.length === 0) reject(new Error('No reviews'));
                else resolve(data);
            },
            error: (e) => reject(e)
        });
    });
}

async function initModel() {
    setStatus('Loading AI model...');
    model = await pipeline('text-classification', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    setStatus('Ready');
    el.btn.disabled = false;
}

function getRandom() {
    return reviews[Math.floor(Math.random() * reviews.length)];
}

async function classify(text) {
    const result = await model(text);
    return result[0];
}

function mapSentiment(result) {
    const { label, score } = result;
    
    if (label === 'POSITIVE' && score > 0.5) {
        return { type: 'positive', text: 'POSITIVE', score, icon: '👍' };
    } else if (label === 'NEGATIVE' && score > 0.5) {
        return { type: 'negative', text: 'NEGATIVE', score, icon: '👎' };
    } else {
        return { type: 'neutral', text: 'NEUTRAL', score, icon: '😐' };
    }
}

function showResult(data) {
    el.result.style.display = 'block';
    el.icon.textContent = data.icon;
    el.label.textContent = data.text;
    el.conf.textContent = `${(data.score * 100).toFixed(1)}% confidence`;
}

/**
 * Determines the appropriate business action based on sentiment analysis results.
 * 
 * Normalizes the AI output into a linear scale (0.0 to 1.0) to simplify
 * threshold comparisons.
 * 
 * @param {number} confidence - The confidence score returned by the API (0.0 to 1.0).
 * @param {string} label - The label returned by the API (e.g., "POSITIVE", "NEGATIVE").
 * @returns {object} An object containing the action metadata (code, message, color).
 */
function determineBusinessAction(confidence, label) {
    // 1. Normalize Score: Map everything to a 0 (Worst) to 1 (Best) scale.
    // If Label is NEGATIVE, a high confidence means a VERY BAD score (near 0).
    let normalizedScore = 0.5; // Default neutral

    if (label === "POSITIVE") {
        normalizedScore = confidence; // e.g., 0.9 -> 0.9 (Great)
    } else if (label === "NEGATIVE") {
        normalizedScore = 1.0 - confidence; // e.g., 0.9 conf -> 0.1 (Terrible)
    }

    // 2. Apply Business Thresholds
    if (normalizedScore <= 0.4) {
        // CASE: Critical Churn Risk
        return {
            actionCode: "OFFER_COUPON",
            uiMessage: "😔 We are truly sorry. Please accept this 50% discount coupon.",
            uiColor: "#ef4444", // Red
            buttonText: "Get 50% OFF Coupon",
            buttonAction: () => { alert("🎉 COUPON: SORRY50 - Valid for 24 hours!"); }
        };
    } else if (normalizedScore < 0.7) {
        // CASE: Ambiguous / Neutral
        return {
            actionCode: "REQUEST_FEEDBACK",
            uiMessage: "📝 Thank you! Could you tell us how we can improve?",
            uiColor: "#6b7280", // Gray
            buttonText: "Take Survey",
            buttonAction: () => { 
                // Замените на ваш реальный URL формы
                window.open("https://forms.gle/your-survey-link", "_blank"); 
                alert("Survey link opened in new tab!");
            }
        };
    } else {
        // CASE: Happy Customer
        return {
            actionCode: "ASK_REFERRAL",
            uiMessage: "⭐ Glad you liked it! Refer a friend and earn rewards.",
            uiColor: "#3b82f6", // Blue
            buttonText: "Refer a Friend",
            buttonAction: () => { 
                alert("🔗 Share this link: https://yourstore.com/refer\nYou'll get 20% off for each friend!"); 
            }
        };
    }
}

/**
 * Отображает бизнес-действие в интерфейсе
 */
function showAction(decision) {
    el.actionBox.style.display = 'block';
    el.actionBox.style.borderColor = decision.uiColor;
    el.actionMessage.textContent = decision.uiMessage;
    el.actionMessage.style.color = decision.uiColor;
    el.actionButton.textContent = decision.buttonText;
    el.actionButton.style.backgroundColor = decision.uiColor;
    
    // Удаляем старый обработчик и добавляем новый
    const oldButton = el.actionButton;
    const newButton = oldButton.cloneNode(true);
    oldButton.parentNode.replaceChild(newButton, oldButton);
    
    // Обновляем ссылку на кнопку в объекте el
    el.actionButton = newButton;
    
    // Добавляем новый обработчик
    el.actionButton.addEventListener('click', decision.buttonAction);
}

async function sendToSheets(review, sentiment, confidence, actionCode) {
    try {
        const payload = {
            ts_iso: new Date().toISOString(),
            event: 'sentiment_analysis',
            variant: 'B',
            userId: `user-${Date.now()}`,
            meta: JSON.stringify({ 
                url: window.location.href,
                userAgent: navigator.userAgent 
            }),
            review: review,
            sentiment_label: sentiment,
            sentiment_confidence: confidence,
            action_taken: actionCode  // НОВОЕ ПОЛЕ
        };
        
        await fetch(SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        console.log('Data sent to Sheets:', payload);
    } catch (e) {
        console.error('Sheets error:', e);
    }
}

async function analyze() {
    try {
        hideError();
        
        el.btn.disabled = true;
        el.loading.style.display = 'block';
        el.result.style.display = 'none';
        el.actionBox.style.display = 'none';  // Скрываем action box
        
        const review = getRandom();
        el.review.textContent = review;
        
        const result = await classify(review);
        const sentiment = mapSentiment(result);
        
        showResult(sentiment);
        
        // НОВОЕ: определяем бизнес-действие
        const decision = determineBusinessAction(result.score, result.label);
        showAction(decision);
        
        // ОБНОВЛЕНО: передаем actionCode в sendToSheets
        await sendToSheets(review, sentiment.text, sentiment.score, decision.actionCode);
        
    } catch (e) {
        showError(e.message);
    } finally {
        el.btn.disabled = false;
        el.loading.style.display = 'none';
    }
}

async function init() {
    try {
        reviews = await loadReviews();
        await initModel();
    } catch (e) {
        showError(e.message);
    }
}

el.btn.addEventListener('click', analyze);
document.addEventListener('DOMContentLoaded', init);
