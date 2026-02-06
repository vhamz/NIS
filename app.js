// Import Transformers.js
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Google Sheets URL
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbz64di0j8z-GMRf_NyrcxNLcI8MtW8p1MFuNSgauVYhacvCfDblJOtvrfLanlofzQqw/exec';

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
    loading: document.getElementById('loadingSpinner')
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

async function sendToSheets(review, sentiment, confidence) {
    try {
        const payload = {
            ts_iso: new Date().toISOString(),
            event: 'sentiment_analysis',
            variant: 'B',
            userId: `user-${Date.now()}`,
            meta: JSON.stringify({ url: window.location.href }),
            review: review,
            sentiment_label: sentiment,
            sentiment_confidence: confidence
        };
        
        await fetch(SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
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
        
        const review = getRandom();
        el.review.textContent = review;
        
        const result = await classify(review);
        const sentiment = mapSentiment(result);
        
        showResult(sentiment);
        
        await sendToSheets(review, sentiment.text, sentiment.score);
        
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
