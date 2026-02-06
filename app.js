// Load Transformers.js library for browser-based ML inference
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Application state
let reviewsData = [];
let aiModel = null;
let userApiKey = null;

// Cache DOM elements for better performance
const elements = {
    status: document.getElementById('statusMessage'),
    error: document.getElementById('errorMessage'),
    analyzeBtn: document.getElementById('analyzeButton'),
    reviewDisplay: document.getElementById('reviewText'),
    resultContainer: document.getElementById('resultBox'),
    resultIconEl: document.getElementById('resultIcon'),
    resultLabelEl: document.getElementById('resultLabel'),
    resultConfEl: document.getElementById('resultConfidence'),
    spinner: document.getElementById('loadingSpinner'),
    tokenInput: document.getElementById('apiTokenInput')
};


// UI Helper Functions
function setStatus(text, statusType = 'loading') {
    const iconMap = {
        loading: 'fa-circle-notch fa-spin',
        ready: 'fa-check-circle',
        error: 'fa-exclamation-circle'
    };
    
    elements.status.innerHTML = `<i class="fas ${iconMap[statusType]}"></i><span>${text}</span>`;
    elements.status.className = `status-bar status-${statusType}`;
}

function displayError(errorText) {
    elements.error.textContent = errorText;
    elements.error.style.display = 'block';
    console.error('[App Error]:', errorText);
}

function clearError() {
    elements.error.style.display = 'none';
}


// Data Loading Functions
async function fetchAndParseReviews() {
    setStatus('Fetching review data...', 'loading');
    
    try {
        const res = await fetch('reviews_test.tsv');
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: Cannot load TSV file`);
        }
        
        const rawTSV = await res.text();
        
        // Parse TSV using PapaParse
        return new Promise((resolve, reject) => {
            Papa.parse(rawTSV, {
                header: true,
                delimiter: '\t',
                skipEmptyLines: true,
                complete: (parseResult) => {
                    if (parseResult.errors.length > 0) {
                        console.warn('[TSV Parse] Warnings detected:', parseResult.errors);
                    }
                    
                    // Extract and validate reviews from 'text' column
                    const validReviews = parseResult.data
                        .map(row => row.text)
                        .filter(txt => txt && typeof txt === 'string' && txt.trim());
                    
                    if (validReviews.length === 0) {
                        reject(new Error('No valid review texts found in TSV'));
                    } else {
                        console.log(`[Data] Loaded ${validReviews.length} reviews`);
                        resolve(validReviews);
                    }
                },
                error: (err) => {
                    reject(new Error(`Parse error: ${err.message}`));
                }
            });
        });
    } catch (err) {
        displayError(`Review loading failed: ${err.message}`);
        throw err;
    }
}


// AI Model Setup
async function setupSentimentModel() {
    try {
        setStatus('Loading AI model (first run may take ~1 minute)...', 'loading');
        
        // Initialize sentiment classification pipeline
        aiModel = await pipeline(
            'text-classification',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
        );
        
        setStatus('AI model ready! Click button to analyze.', 'ready');
        console.log('[Model] Successfully loaded');
        return true;
    } catch (err) {
        const msg = `Model initialization failed: ${err.message}`;
        setStatus(msg, 'error');
        displayError(msg);
        throw err;
    }
}

// Review Selection
function pickRandomReview() {
    if (reviewsData.length === 0) {
        throw new Error('No reviews in dataset');
    }
    return reviewsData[Math.floor(Math.random() * reviewsData.length)];
}

// Sentiment Analysis
async function classifySentiment(reviewText) {
    if (!aiModel) {
        throw new Error('AI model not ready');
    }
    
    // Run model inference - returns array like [{label: "POSITIVE", score: 0.99}]
    const predictions = await aiModel(reviewText);
    return predictions[0]; // Take top prediction
}

// Sentiment Mapping
function categorizeSentiment(prediction) {
    const { label, score } = prediction;
    
    // Map to three categories based on label and confidence
    if (label === 'POSITIVE' && score > 0.5) {
        return {
            category: 'positive',
            displayLabel: 'POSITIVE',
            confidenceScore: score,
            iconClass: 'fa-thumbs-up'
        };
    } else if (label === 'NEGATIVE' && score > 0.5) {
        return {
            category: 'negative',
            displayLabel: 'NEGATIVE',
            confidenceScore: score,
            iconClass: 'fa-thumbs-down'
        };
    } else {
        return {
            category: 'neutral',
            displayLabel: 'NEUTRAL',
            confidenceScore: score,
            iconClass: 'fa-question-circle'
        };
    }
}


// UI Update Functions
function renderSentimentResult(sentimentData) {
    const { category, displayLabel, confidenceScore, iconClass } = sentimentData;
    
    // Apply styling based on category
    elements.resultContainer.className = `sentiment-result ${category}`;
    elements.resultContainer.style.display = 'block';
    
    // Set icon
    elements.resultIconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;
    
    // Set label text
    elements.resultLabelEl.textContent = displayLabel;
    
    // Format and display confidence percentage
    const percentage = (confidenceScore * 100).toFixed(1);
    elements.resultConfEl.textContent = `Confidence: ${percentage}%`;
}

// Analytics Logging
async function logAnalyticsData(reviewText, sentimentLabel, confidence, metadata) {
    // Skip if no API key provided
    if (!userApiKey || !userApiKey.trim()) {
        console.log('[Analytics] Skipped - no API key');
        return;
    }
    
    try {
        const timestamp = new Date().toISOString();
        
        const analyticsPayload = {
            ts_iso: timestamp,
            event: 'sentiment_analysis',
            variant: 'B',
            userId: metadata.userId || 'guest',
            meta: JSON.stringify({
                page: metadata.page || window.location.href,
                ua: navigator.userAgent,
                sentiment: sentimentLabel,
                confidence: confidence
            }),
            review: reviewText,
            sentiment_label: sentimentLabel,
            sentiment_confidence: confidence
        };
        
        console.log('[Analytics] Data prepared:', analyticsPayload);
        
        // TODO: Implement actual Google Sheets API call here
        // For now, just logging to console
        
    } catch (err) {
        console.error('[Analytics] Logging failed:', err);
        // Don't throw - analytics failure shouldn't break the app
    }
}


// Main Analysis Workflow
async function performAnalysis() {
    try {
        clearError();
        
        // Validate data availability
        if (reviewsData.length === 0) {
            displayError('No review data loaded. Please refresh.');
            return;
        }
        
        // UI: Show loading state
        elements.analyzeBtn.disabled = true;
        elements.spinner.style.display = 'block';
        elements.resultContainer.style.display = 'none';
        
        // Step 1: Pick random review
        const chosenReview = pickRandomReview();
        elements.reviewDisplay.textContent = chosenReview;
        
        // Step 2: Run AI classification
        const rawPrediction = await classifySentiment(chosenReview);
        
        // Step 3: Map to UI format
        const sentimentResult = categorizeSentiment(rawPrediction);
        
        // Step 4: Display results
        renderSentimentResult(sentimentResult);
        
        // Step 5: Log analytics (optional)
        await logAnalyticsData(
            chosenReview,
            sentimentResult.displayLabel,
            sentimentResult.confidenceScore,
            {
                userId: `user-${Date.now()}`,
                page: window.location.href
            }
        );
        
    } catch (err) {
        displayError(`Analysis error: ${err.message}`);
    } finally {
        // UI: Reset state
        elements.analyzeBtn.disabled = false;
        elements.spinner.style.display = 'none';
    }
}


// App Initialization
async function initializeApp() {
    try {
        // Phase 1: Load review dataset
        reviewsData = await fetchAndParseReviews();
        console.log(`[Init] Dataset ready: ${reviewsData.length} reviews`);
        
        // Phase 2: Load AI model
        await setupSentimentModel();
        
        // Enable analyze button
        elements.analyzeBtn.disabled = false;
        
    } catch (err) {
        console.error('[Init] Startup failed:', err);
        setStatus('Initialization error. Refresh page to retry.', 'error');
    }
}

// Event Handlers
elements.analyzeBtn.addEventListener('click', performAnalysis);

elements.tokenInput.addEventListener('input', (event) => {
    userApiKey = event.target.value.trim();
    
    // Persist to browser storage
    if (userApiKey) {
        localStorage.setItem('hf_api_token', userApiKey);
    }
});

// App Startup
document.addEventListener('DOMContentLoaded', () => {
    // Restore saved API token
    const savedKey = localStorage.getItem('hf_api_token');
    if (savedKey) {
        elements.tokenInput.value = savedKey;
        userApiKey = savedKey;
    }
    
    // Start app
    initializeApp();
});
