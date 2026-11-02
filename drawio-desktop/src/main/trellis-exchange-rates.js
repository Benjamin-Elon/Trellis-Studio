/** Country currency defaults and cached display estimates. Agreement values never pass through this service. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
const groups = { // NEW
    EUR: 'AD AT AX BE BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT', // NEW
    USD: 'AS BQ EC FM GU IO MH MP PA PR PW SV TC TL UM US VG VI', // NEW
    GBP: 'GB GG IM JE', AUD: 'AU CC CX HM KI NR NF TV', NZD: 'CK NU NZ PN TK', XAF: 'CF CG CM GA GQ TD', // NEW
    XCD: 'AG AI DM GD KN LC MS VC', XOF: 'BF BJ CI GW ML NE SN TG', DKK: 'DK FO GL', NOK: 'BV NO SJ', // NEW
    CAD: 'CA', CHF: 'CH LI', ZAR: 'ZA', MAD: 'MA EH', ILS: 'IL PS', XPF: 'NC PF WF' // NEW
}; // NEW
const individuals = 'AE:AED AF:AFN AL:ALL AM:AMD AO:AOA AR:ARS AW:AWG AZ:AZN BA:BAM BB:BBD BD:BDT BG:EUR BH:BHD BI:BIF BM:BMD BN:BND BO:BOB BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CD:CDF CL:CLP CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CZ:CZK DJ:DJF DO:DOP DZ:DZD EG:EGP ER:ERN ET:ETB FJ:FJD FK:FKP GE:GEL GH:GHS GI:GIP GM:GMD GN:GNF GT:GTQ GY:GYD HK:HKD HN:HNL HT:HTG HU:HUF ID:IDR IN:INR IQ:IQD IR:IRR IS:ISK JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KM:KMF KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LK:LKR LR:LRD LS:LSL LY:LYD MD:MDL MG:MGA MK:MKD MM:MMK MN:MNT MO:MOP MR:MRU MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NA:NAD NG:NGN NI:NIO NP:NPR OM:OMR PE:PEN PG:PGK PH:PHP PK:PKR PL:PLN PY:PYG QA:QAR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SL:SLE SO:SOS SR:SRD SS:SSP ST:STN SY:SYP SZ:SZL TH:THB TJ:TJS TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TW:TWD TZ:TZS UA:UAH UG:UGX UY:UYU UZ:UZS VE:VES VN:VND VU:VUV WS:WST YE:YER ZM:ZMW'; // NEW
const defaults = Object.fromEntries(Object.entries(groups).flatMap(([currency, countries]) => countries.split(' ').map(country => [country, currency]))); // NEW
for (const pair of individuals.split(' ')) { const [country, currency] = pair.split(':'); defaults[country] = currency; } // NEW
const names = new Intl.DisplayNames(['en'], { type: 'region' }); // NEW
const byName = Object.fromEntries(Object.keys(defaults).map(code => [names.of(code).toLowerCase(), code])); // NEW
Object.assign(byName, { 'united states of america': 'US', 'usa': 'US', 'uk': 'GB', 'czech republic': 'CZ', 'russian federation': 'RU', 'south korea': 'KR', 'viet nam': 'VN' }); // NEW
export function countryCurrency(country) { // NEW
    const value = String(country || '').trim(); // NEW
    return defaults[value.toUpperCase()] || defaults[byName[value.toLowerCase()]] || null; // NEW
} // NEW
export function createExchangeRates({ directory, fetchRate = globalThis.fetch, now = Date.now }) { // NEW
    let cachePromise, writeQueue = Promise.resolve(); // NEW
    const inflight = new Map(), failures = new Map(), filename = path.join(directory, 'exchange-display-rates.json'); // NEW
    const code = value => { if (!/^[A-Z]{3}$/.test(value || '')) throw new Error('Invalid currency.'); return value; }; // NEW
    function validDate(value) { // NEW
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false; // NEW
        const date = new Date(value + 'T12:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; // NEW
    } // NEW
    const validRate = row => row && Number.isFinite(row.rate) && row.rate > 0 && validDate(row.date) && Number.isSafeInteger(row.retrievedAt) && row.retrievedAt >= 0; // NEW
    const expired = rate => !rate || now() - rate.retrievedAt >= 86400000 || rate.retrievedAt > now() + 300000; // NEW
    async function cache() { // NEW
        cachePromise ||= fs.open(filename, 'r').then(async handle => { // NEW
            try { if ((await handle.stat()).size > 2000000) return {}; const parsed = JSON.parse(await handle.readFile('utf8')); return Object.fromEntries(Object.entries(parsed).filter(([key, row]) => /^[A-Z]{3}:[A-Z]{3}$/.test(key) && validRate(row))); } finally { await handle.close(); } // NEW
        }).catch(() => ({})); // NEW: a damaged disposable cache must not hide original prices.
        return cachePromise; // NEW
    } // NEW
    async function persist(value) { // NEW
        writeQueue = writeQueue.catch(() => {}).then(async () => { // NEW
            await fs.mkdir(directory, { recursive: true }); // NEW
            const temporary = filename + '.tmp'; // NEW
            await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, filename); // NEW
        }); // NEW
        return writeQueue; // NEW
    } // NEW
    /** Only currency codes reach Frankfurter; amounts and agreement contents stay on this device. */ // NEW
    async function update(base, quote, values) { // NEW
        const key = base + ':' + quote; // NEW
        if (failures.has(key) && now() - failures.get(key).at < 300000) return failures.get(key).message; // NEW
        if (inflight.has(key)) return inflight.get(key); // NEW
        const operation = (async () => { // NEW
            try { // NEW
                const response = await fetchRate('https://api.frankfurter.dev/v2/rate/' + base.toLowerCase() + '/' + quote.toLowerCase(), { signal: AbortSignal.timeout(5000), redirect: 'error' }); // NEW
                if (!response.ok) throw new Error('Exchange-rate provider unavailable.'); // NEW
                if (Number(response.headers?.get?.('content-length')) > 4096) throw new Error('Invalid rate response.'); // NEW
                const body = await response.text(); if (body.length > 4096) throw new Error('Invalid rate response.'); // NEW
                const row = JSON.parse(body); // NEW
                if (String(row.base).toUpperCase() !== base || String(row.quote).toUpperCase() !== quote || !Number.isFinite(row.rate) || row.rate <= 0 || !validDate(row.date) || row.date > new Date(now()).toISOString().slice(0, 10)) throw new Error('Invalid rate response.'); // NEW
                values[key] = { rate: row.rate, date: row.date, retrievedAt: now() }; // NEW
                if (Object.keys(values).length > 1000) delete values[Object.keys(values).sort((a, b) => values[a].retrievedAt - values[b].retrievedAt)[0]]; // NEW
                await persist(values); failures.delete(key); return undefined; // NEW
            } catch (failure) { failures.set(key, { at: now(), message: failure.message }); return failure.message; } // NEW
        })(); // NEW
        inflight.set(key, operation); try { return await operation; } finally { inflight.delete(key); } // NEW
    } // NEW
    async function estimate({ base, quote, amount }) { // NEW
        code(base); code(quote); // NEW
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid display amount.'); // NEW
        if (base === quote) return { amount, originalAmount: amount, base, quote, rate: 1, approximate: false }; // NEW
        const values = await cache(), key = base + ':' + quote; // NEW
        const error = expired(values[key]) ? await update(base, quote, values) : undefined, rate = values[key]; // NEW
        if (!rate || !Number.isFinite(amount * rate.rate)) return { amount: null, originalAmount: amount, base, quote, approximate: true, unavailable: true, error }; // NEW
        return { amount: amount * rate.rate, originalAmount: amount, base, quote, ...rate, approximate: true, stale: !!error || expired(rate), error }; // NEW
    } // NEW
    return { estimate }; // NEW
} // NEW
