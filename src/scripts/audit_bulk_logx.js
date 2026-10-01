
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URLS_FILE = path.join(__dirname, 'urls_to_audit.txt');
const REPORT_FILE = path.join(__dirname, 'optimizely_bulk_report.json');
const IFRAME_ID = 'sp_message_iframe_1400925';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function acceptConsent(page) {
    try {
        const iframeElement = await page.waitForSelector(`iframe#${IFRAME_ID}`, { timeout: 5000 }).catch(() => null);
        if (iframeElement) {
            const frame = await iframeElement.contentFrame();
            if (frame) {
                // Try multiple button text variations
                const clicked = await frame.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const target = btns.find(b =>
                        b.textContent.includes('Accept All') ||
                        b.textContent.includes('Agree') ||
                        b.title.includes('Accept All')
                    );
                    if (target) {
                        target.click();
                        return true;
                    }
                    return false;
                });
                if (clicked) {
                    // console.log('  [Consent] "Accept All" clicked.');
                    await delay(2000);
                }
            }
        }
    } catch (e) {
        // Ignore consent errors, just proceed
    }
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 5000) { // Limit scroll
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

async function runAudit() {
    const urls = fs.readFileSync(URLS_FILE, 'utf8').split('\n').map(u => u.trim()).filter(u => u.length > 0);
    const results = [];

    console.log(`Starting audit for ${urls.length} URLs...`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--window-size=1366,768']
    });

    for (const url of urls) {
        const context = await browser.createBrowserContext(); // Clean context for each/or shared? Shared is faster but context clean safer.
        // Let's use clean context to ensure consent doesn't stick weirdly if we want to test "fresh load" + "action"
        // But user wants "Accept" tested. If we accept once, it might stick?
        // Let's try to just accept on every page if banner appears.

        const page = await context.newPage();
        const pageRequests = [];

        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes('logx.optimizely.com')) {
                pageRequests.push({
                    url: req.url(),
                    method: req.method(),
                    payload: req.postData()
                });
            }
            req.continue();
        });

        console.log(`Scanning: ${url}`);
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await acceptConsent(page);
            await autoScroll(page);
            await delay(3000); // Wait for post-scroll events

            const logxFound = pageRequests.length > 0;
            console.log(`  -> Logx Found: ${logxFound ? 'YES' : 'NO'} (${pageRequests.length} requests)`);

            results.push({
                url,
                logxFound,
                requestCount: pageRequests.length,
                requests: pageRequests
            });

        } catch (e) {
            console.log(`  -> Error: ${e.message}`);
            results.push({ url, error: e.message, logxFound: false });
        }

        await context.close();
    }

    await browser.close();
    fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
    console.log(`Audit complete. Results saved to ${REPORT_FILE}`);
}

runAudit();
