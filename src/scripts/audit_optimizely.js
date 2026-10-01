
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PAGES = [
    'https://www.sky.com',
    'https://www.sky.com/shop/mobile',
    'https://www.sky.com/help/home'
];
const IFRAME_ID = 'sp_message_iframe_1400925';

// Helper to wait
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function captureData(page) {
    // We will capture requests in real-time
    const requests = [];

    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = req.url();
        if (url.includes('optimizely.com')) {
            requests.push({
                url: url,
                type: url.includes('logx') ? 'TRACKING (logx)' : 'LIBRARY (cdn/other)',
                method: req.method(),
                postData: req.postData(),
                initiator: req.initiator()
            });
        }
        req.continue();
    });

    return requests;
}

async function analyzePage(page, pageUrl, contextName) {
    console.log(`Analyzing ${pageUrl} [${contextName}]...`);

    // 1. Implementation Check (DOM)
    const scripts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script'))
            .filter(s => s.src && s.src.includes('optimizely'))
            .map(s => ({
                src: s.src,
                async: s.async,
                defer: s.defer,
                parentTag: s.parentElement ? s.parentElement.tagName : 'UNKNOWN'
            }));
    });

    // 2. Global Object
    const globalObj = await page.evaluate(() => {
        try {
            return {
                exists: !!window.optimizely,
                activeExperiments: window.optimizely && window.optimizely.get ? Object.keys(window.optimizely.get('state').getExperimentStates()) : [],
                data: window.optimizely ? 'Present' : 'Absent'
            };
        } catch (e) { return { error: e.toString() }; }
    });

    return {
        url: pageUrl,
        domScripts: scripts,
        globalObject: globalObj
    };
}

async function handleConsent(page, action) {
    try {
        console.log(`Attempting to ${action} consent...`);
        const iframeElement = await page.waitForSelector(`iframe#${IFRAME_ID}`, { timeout: 8000 }).catch(() => null);
        if (!iframeElement) {
            console.log('No consent banner found (might already be handled).');
            return false;
        }

        const frame = await iframeElement.contentFrame();
        if (!frame) return false;

        const selectorStr = action === 'ACCEPT' ? 'Accept' : 'Reject';

        await frame.waitForSelector('button', { timeout: 5000 }).catch(() => { });
        const clicked = await frame.evaluate((act) => {
            const btns = Array.from(document.querySelectorAll('button'));
            const target = btns.find(b => b.textContent.includes(act) || (b.title && b.title.includes(act)) || (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes(act)));
            if (target) {
                target.click();
                return true;
            }
            return false;
        }, selectorStr);

        if (clicked) {
            console.log(`${action} clicked. Waiting...`);
            await delay(5000); // Wait for settlement
            return true;
        } else {
            console.log(`Could not find ${action} button.`);
        }
    } catch (e) {
        console.log(`Consent Error (${action}):`, e.message);
    }
    return false;
}

async function runAudit() {
    console.log('Launching browser for DEEP AUDIT...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768']
    });

    const finalReport = {
        preConsent: [],
        acceptAll: [],
        rejectAll: []
    };

    // --- SCENARIO 1: PRE-CONSENT (Check each page fresh) ---
    console.log('\n=== PHASE 1: PRE-CONSENT ===');
    for (const url of PAGES) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        const detectedRequests = await captureData(page);

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(3000);
            const analysis = await analyzePage(page, url, 'Pre-Consent');
            finalReport.preConsent.push({
                page: url,
                analysis: analysis,
                requests: detectedRequests
            });
        } catch (e) { console.log(`Error on ${url}:`, e.message); }
        await context.close();
    }


    // --- SCENARIO 2: ACCEPT ALL (Flow) ---
    console.log('\n=== PHASE 2: ACCEPT ALL ===');
    {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        const detectedRequests = await captureData(page);

        // Landing & Consent
        try {
            await page.goto(PAGES[0], { waitUntil: 'networkidle2', timeout: 60000 });
            await handleConsent(page, 'ACCEPT');

            // Audit Landing (Post-Consent)
            finalReport.acceptAll.push({
                page: PAGES[0],
                analysis: await analyzePage(page, PAGES[0], 'Accept-All > Landing'),
                requests: [...detectedRequests] // Snapshot so far
            });

            // Navigate to others (Consent should stick)
            for (let i = 1; i < PAGES.length; i++) {
                // Clear request log for new page to avoid duplication confusion, or keep cumulative? 
                // Let's create a fresh bucket for "requests triggered specifically during this navigation" roughly.
                // Actually, detectedRequests array fills up continuously. We'll snapshot it.
                // Better: filter requests by timestamp? Simplified: just listing all session requests is fine, user wants to see "Is it sending data?"

                await page.goto(PAGES[i], { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(3000);
                finalReport.acceptAll.push({
                    page: PAGES[i],
                    analysis: await analyzePage(page, PAGES[i], 'Accept-All > ' + PAGES[i]),
                    requests: detectedRequests.filter(r => r.url.includes('optimizely')) // Current total list
                });
            }

        } catch (e) { console.log('Error in Accept Flow:', e.message); }
        await context.close();
    }


    // --- SCENARIO 3: REJECT ALL (Flow) ---
    console.log('\n=== PHASE 3: REJECT ALL ===');
    {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        const detectedRequests = await captureData(page);

        // Landing & Consent
        try {
            await page.goto(PAGES[0], { waitUntil: 'networkidle2', timeout: 60000 });
            await handleConsent(page, 'Reject'); // "Reject All" button usually contains "Reject"

            // Audit Landing (Post-Reject)
            finalReport.rejectAll.push({
                page: PAGES[0],
                analysis: await analyzePage(page, PAGES[0], 'Reject-All > Landing'),
                requests: [...detectedRequests]
            });

            // Navigate to others
            for (let i = 1; i < PAGES.length; i++) {
                await page.goto(PAGES[i], { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(3000);
                finalReport.rejectAll.push({
                    page: PAGES[i],
                    analysis: await analyzePage(page, PAGES[i], 'Reject-All > ' + PAGES[i]),
                    requests: detectedRequests.filter(r => r.url.includes('optimizely'))
                });
            }

        } catch (e) { console.log('Error in Reject Flow:', e.message); }
        await context.close();
    }

    await browser.close();

    // Summarize Findings
    console.log('\n--- ANALYSIS SUMMARY ---');
    // We want to know: Did logx occur? Was there payload?
    const hasLogX = (list) => list.some(i => i.requests.some(r => r.type.includes('TRACKING')));

    console.log(`Pre-Consent Tracking: ${hasLogX(finalReport.preConsent)}`);
    console.log(`Accept-All Tracking:  ${hasLogX(finalReport.acceptAll)}`);
    console.log(`Reject-All Tracking:  ${hasLogX(finalReport.rejectAll)}`);

    fs.writeFileSync(path.join(__dirname, 'optimizely_deep_report.json'), JSON.stringify(finalReport, null, 2));
}

runAudit();
