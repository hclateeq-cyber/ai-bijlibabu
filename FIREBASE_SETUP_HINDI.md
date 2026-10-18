# Ai Bijlibabu — Firebase Online Master Data Setup (Hindi)

यह package GitHub Pages के static website के साथ Firebase Authentication + Cloud Firestore इस्तेमाल करता है।
यह Firebase project अपने आप नहीं बनाता और न ही credentials अनुमान से भरता है। एक बार नीचे के चरण पूरे करें।

## यह क्या करेगा
- Admin email/password login (website में public sign-up नहीं है)
- CSV, XLSX/XLS, JSON upload और validation/preview
- Master Data को छोटे Firestore chunks में upload
- पूरा upload सफल होने के बाद active version pointer बदलना; सभी visitors active version पढ़ेंगे
- Cloud master data को JSON backup में डाउनलोड करना
- Firestore Rules में सिर्फ एक Admin UID को write अनुमति

## Step 1 — Firebase project बनाएं
1. https://console.firebase.google.com/ खोलें और Google account से sign in करें।
2. **Create a project** चुनें; नाम `ai-bijlibabu` या अपनी पसंद का रखें।
3. Project बन जाने पर Project Overview में **Web app** (`</>`) जोड़ें। App nickname `Ai Bijlibabu Web` रखें।
4. Firebase config object में `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` values मिलेंगी।

## Step 2 — Website config भरें
1. GitHub repository `hclateeq-cyber/ai-bijilibabu` में `firebase-config.js` खोलें।
2. `PASTE_API_KEY_HERE`, `PASTE_PROJECT_ID_HERE` आदि को Firebase Console से मिली exact values से बदलें।
3. `authDomain` आम तौर पर `YOUR_PROJECT_ID.firebaseapp.com` होता है; Console की exact value को प्राथमिकता दें।
4. Commit changes करें। Firebase Web config browser में दिखाई देता है; इसे password न समझें। Service-account private key या admin password कभी भी HTML/JS में न रखें।

## Step 3 — Email/Password login enable करें
1. Firebase Console > **Build > Authentication** > **Get started**।
2. Sign-in method / Sign-in providers में **Email/Password** enable करें और Save करें।
3. Authentication > Users > **Add user** पर क्लिक करके केवल अपना Admin email और मजबूत password बनाएं। Website में कोई sign-up button नहीं है।
4. बने हुए user को खोलकर उसका **UID** copy करें। UID ईमेल नहीं है; यह Firebase का user ID है।

Official guide: https://firebase.google.com/docs/auth/web/password-auth

## Step 4 — Firestore database और सुरक्षित Rules
1. Firebase Console > **Build > Firestore Database** > Create database।
2. Database बन जाने के बाद **Rules** tab खोलें।
3. इस package की `firestore.rules` फ़ाइल का पूरा content copy करें।
4. `REPLACE_WITH_YOUR_ADMIN_UID` को Step 3 में copy किए गए अपने UID से बदलें।
5. Rules editor में पूरा content paste करके **Publish** करें।
6. Production data डालने से पहले सुनिश्चित करें कि Rules में placeholder बाकी न हो। Test mode / `allow read, write: if true` इस्तेमाल न करें।

Official guide: https://firebase.google.com/docs/firestore/security/get-started

## Step 5 — GitHub Pages पर फाइलें अपलोड करें
1. ZIP को Extract All करें।
2. Repository `https://github.com/hclateeq-cyber/ai-bijilibabu` में website के root में `index.html`, `firebase-config.js`, `firebase-cloud.js`, `firestore.rules`, `README.md`, `assets/` और `Rate Schedule FY 2014-15.pdf` अपलोड करें।
3. `index.html` root में होना चाहिए, किसी nested folder में नहीं।
4. Commit changes करें; Settings > Pages में `main` / `/(root)` source रखें।
5. GitHub Pages deployment पूरा होने दें।

## Step 6 — पहली बार test करें
1. Website खोलें: https://hclateeq-cyber.github.io/ai-bijilibabu/
2. Admin & Latest Master Data section खोलें।
3. Admin email/password से login करें।
4. `Download Template CSV` से template लें, sample values बदलें और पहले छोटी फ़ाइल से test करें।
5. `Preview & Validate` करें; preview और record count सही होने पर ही `Publish Online` दबाएँ।
6. दूसरे browser/incognito में वेबसाइट खोलकर देखें कि public dashboard पर published summary दिखाई देती है।
7. `Download Cloud Backup` से JSON backup रखें।

## Supported summary columns
`division`, `SDO_CODE`, `category`, `consumers`, `billed`, `collection`, `arrears`, `feeder`, `substation`.
Aliases: `subdivision`, `subdivision_name`, `sdo_name`, `SUPPLY_TYPE`, `TARIFF_CODE`, `BILLED_AMOUNT`, `CURRENT_ASSESSMENT`, `TOTAL_PAY_AMT`, `TOTAL_OUTSTANDING`, `FEEDER`, `SUBSTATION`.

Built-in SDO codes:
- Akbarpur: `SDO2920231`
- Pukhrayan: `SDO2920232`
- Sikandra: `SDO2920233`

## Important limitations and security
- This cloud panel publishes **summary/aggregate master data** to a dashboard accessible to all visitors. Do not upload consumer names, account IDs, phone numbers, addresses, meter identifiers, or other personal/sensitive data.
- Only the configured Admin UID can write according to Firestore Rules. Never use an HTML-only password or localStorage password as security.
- Firebase Web config is not a secret; Security Rules are the security boundary.
- Upload uses Firestore documents in chunks of 75 rows. Large datasets cause many document reads/writes and may incur costs or quota limits. For very large raw monthly files (e.g. 100+ MB), first aggregate/reduce the file, or use a storage/backend architecture designed for large files. Test with a small file before publishing.
- Old versions remain in Firestore for rollback and backup. Rules let public visitors read only the active version; only the owner UID can read/manage inactive versions.
- The bill calculator is still an estimate unless the selected tariff, FPPAS, ED, LPSC, subsidy, and applicable UPERC orders are verified for the exact billing period. Cloud sync does not certify the calculation as an official bill.

## Troubleshooting
- `Setup required`: check `firebase-config.js` and commit it.
- `auth/invalid-credential`: check that Email/Password is enabled and that the Admin user exists.
- `permission-denied`: check Firestore Rules and ensure the UID exactly matches.
- `Missing or insufficient permissions` on public load: publish Rules and ensure the active pointer exists.
- `Firebase: Error (auth/unauthorized-domain)`: Authentication > Settings > Authorized domains; add `hclateeq-cyber.github.io`.
