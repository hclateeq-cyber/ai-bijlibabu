import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, setDoc, writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const status = (msg, error=false) => {
  const el=$("fbAdminStatus");
  if(el){el.textContent=msg;el.style.color=error?"#b91c1c":"";}
};
const previewStatus = (msg, error=false) => {
  const el=$("fbPreviewStatus");
  if(el){el.textContent=msg;el.style.color=error?"#b91c1c":"";}
};
const configured = firebaseConfig && firebaseConfig.apiKey &&
  !Object.values(firebaseConfig).some(v=>String(v).includes("PASTE_")) &&
  firebaseConfig.projectId && !String(firebaseConfig.projectId).includes("PASTE_");

let auth=null, db=null, currentUser=null, pendingRows=null, latestRows=[], latestMeta=null;
const ownerControls=["fbPreviewUpload","fbPublishMaster","fbBackupMaster"];
function setSignedIn(user){
  currentUser=user||null;
  $("fbAdminLogin").disabled=!!user;
  $("fbAdminLogout").disabled=!user;
  $("fbAdminEmail").disabled=!!user;
  $("fbAdminPassword").disabled=!!user;
  ownerControls.forEach(id=>{if($(id))$(id).disabled=!user;});
  if(user){
    status(`Signed in: ${user.email||user.uid}. यदि Rules में आपका UID Admin UID से मेल खाता है, तभी Publish अनुमति मिलेगी। UID: ${user.uid}`);
    const badge=$("fbConnectionBadge");if(badge){badge.textContent="Firebase connected";badge.className="badge";}
  }else{
    status("Admin login नहीं है। सार्वजनिक रूप से प्रकाशित Master Data पढ़ा जा सकता है; upload/publish के लिए Admin login करें।");
  }
}
function download(name,content,type="application/octet-stream"){
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function csvText(rows){
  const keys=["division","SDO_CODE","category","consumers","billed","collection","arrears","feeder","substation"];
  const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
  return "\ufeff"+keys.join(",")+"\r\n"+rows.map(r=>keys.map(k=>q(r[k])).join(",")).join("\r\n");
}
function normalize(row){
  const aliases={
    division:["division","subdivision","subdivision_name","sdo_name","division_name"],
    code:["SDO_CODE","SDOCODE","SUBDIVISION_CODE","SUBDIVISIONID","DIVISION_CODE"],
    category:["category","supply_type","supplytype","tariff_code","tariff","category_code"],
    consumers:["consumers","consumer_count","no_of_consumers","accounts","total_consumers","count"],
    billed:["billed","billed_amount","current_assessment","assessment","bill_amount","total_bill_amount"],
    collection:["collection","total_pay_amt","total_payment","pay_amt","payment","payments","collected_amount"],
    arrears:["arrears","total_outstanding","outstanding","arrear_amount","balance"],
    feeder:["feeder","feeder_name","feeder_code"],
    substation:["substation","substation_name","ss_name"]
  };
  const get=(keys)=>{for(const k of keys){const found=Object.keys(row).find(x=>x.replace(/[^a-z0-9]/gi,"").toLowerCase()===k.replace(/[^a-z0-9]/gi,"").toLowerCase());if(found&&row[found]!==undefined&&row[found]!==null&&String(row[found]).trim()!=="")return row[found];}return "";};
  const num=v=>{if(typeof v==="number")return Number.isFinite(v)?v:0;const n=Number(String(v??"").replace(/[₹,\s]/g,""));return Number.isFinite(n)?n:NaN;};
  const code=String(get(aliases.code)).trim();
  let division=String(get(aliases.division)).trim();
  if(!division){if(["SDO2920231","2920231"].includes(code.toUpperCase()))division="Akbarpur";else if(["SDO2920232","2920232"].includes(code.toUpperCase()))division="Pukhrayan";else if(["SDO2920233","2920233"].includes(code.toUpperCase()))division="Sikandra";else division=code;}
  const consumers=num(get(aliases.consumers)),billed=num(get(aliases.billed)),collection=num(get(aliases.collection)),arrears=num(get(aliases.arrears));
  if(!division)throw new Error("एक या अधिक records में subdivision/division या SDO_CODE नहीं मिला।");
  for(const [label,value] of [["consumers",consumers],["billed",billed],["collection",collection],["arrears",arrears]])if(!Number.isFinite(value)||value<0)throw new Error(`${label} में invalid या negative value मिली।`);
  return {division,SDO_CODE:code||({"Akbarpur":"SDO2920231","Pukhrayan":"SDO2920232","Sikandra":"SDO2920233"}[division]||""),category:String(get(aliases.category)||"Unknown"),consumers,billed,collection,arrears,feeder:String(get(aliases.feeder)||""),substation:String(get(aliases.substation)||"")};
}
function renderPreview(rows){
  const head=$("fbPreviewHead"),body=$("fbPreviewBody");
  const cols=["division","SDO_CODE","category","consumers","billed","collection","arrears","feeder","substation"];
  head.innerHTML="<tr>"+cols.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  body.innerHTML=rows.slice(0,30).map(r=>"<tr>"+cols.map(c=>`<td>${String(r[c]??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]))}</td>`).join("")+"</tr>").join("");
}
async function loadPublishedMaster(){
  if(!configured)return;
  try{
    const control=await getDoc(doc(db,"masterControl","current"));
    if(!control.exists()) {previewStatus("अभी कोई Cloud Master Data प्रकाशित नहीं है। Admin login करके पहला upload करें।");return;}
    const meta=control.data(), version=meta.activeVersion;
    if(!version)return;
    const versionSnap=await getDoc(doc(db,"masterVersions",version));
    if(!versionSnap.exists())throw new Error("Published version metadata नहीं मिला।");
    const chunksSnap=await getDocs(collection(db,"masterVersions",version,"chunks"));
    const chunks=chunksSnap.docs.map(d=>d.data()).sort((a,b)=>(a.chunkIndex||0)-(b.chunkIndex||0));
    latestRows=chunks.flatMap(c=>Array.isArray(c.rows)?c.rows:[]);
    latestMeta={...versionSnap.data(),version};
    if(latestRows.length){
      window.dispatchEvent(new CustomEvent("aibijlibabu-cloud-master-loaded",{detail:{rows:latestRows,updatedBy:latestMeta.updatedBy||meta.updatedBy||"Admin",updatedAt:latestMeta.updatedAt?.toDate?.().toLocaleString("en-IN")||"latest version"}}));
      $("fbCloudMeta").textContent=`Latest online version: ${version} · ${latestRows.length.toLocaleString("en-IN")} records · ${latestMeta.updatedAt?.toDate?.().toLocaleString("en-IN")||"date not available"}`;
      previewStatus(`Cloud Master Data loaded: ${latestRows.length.toLocaleString("en-IN")} records. Preview में पहले 30 rows दिखेंगी।`);
      renderPreview(latestRows);
      $("fbBackupMaster").disabled=!currentUser;
    }
  }catch(e){console.error(e);previewStatus("Cloud data load नहीं हुआ: "+(e.message||e),true);}
}
async function readFileRows(file){
  const ext=file.name.split(".").pop().toLowerCase();
  let objects=[];
  if(ext==="json"){
    const v=JSON.parse(await file.text());
    objects=Array.isArray(v)?v:(Array.isArray(v.rows)?v.rows:[]);
  }else{
    if(!window.XLSX)throw new Error("CSV/Excel parser उपलब्ध नहीं है। Internet connection जाँचें या JSON/CSV try करें।");
    const ab=await file.arrayBuffer(),wb=window.XLSX.read(ab,{type:"array"});
    if(!wb.SheetNames.length)throw new Error("Excel file में कोई sheet नहीं मिली।");
    objects=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});
  }
  if(!objects.length)throw new Error("फ़ाइल में कोई data row नहीं मिली।");
  const headers=Object.keys(objects[0]).map(x=>x.toLowerCase().replace(/[^a-z0-9]/g,""));
  const hasDivision=headers.some(h=>["division","subdivision","subdivisionname","sdo_name","divisionname","sdo_code","sdocode","subdivisioncode","subdivisionid","divisioncode"].includes(h));
  const hasMetric=headers.some(h=>["consumers","consumercount","noofconsumers","accounts","totalconsumers","count","billed","billedamount","currentassessment","assessment","billamount","totalbillamount","collection","totalpayamt","totalpayment","payamt","payment","payments","collectedamount","arrears","totaloutstanding","outstanding","arrearamount","balance"].includes(h));
  if(!hasDivision||!hasMetric)throw new Error("Required columns नहीं मिले। Subdivision/SDO_CODE और कम-से-कम एक summary metric (consumers, billed, collection, arrears) चाहिए।");
  const normalized=objects.map(normalize).filter(r=>r.division && (r.consumers||r.billed||r.collection||r.arrears||r.feeder||r.substation||r.SDO_CODE));
  if(!normalized.length)throw new Error("कोई उपयोगी summary record नहीं मिला।");
  return normalized;
}
$("fbAdminLogin").addEventListener("click",async()=>{
  if(!configured){status("पहले firebase-config.js में Firebase Console की config values भरें।",true);return;}
  try{await signInWithEmailAndPassword(auth,$("fbAdminEmail").value.trim(),$("fbAdminPassword").value);$("fbAdminPassword").value="";}
  catch(e){status("Login असफल: "+(e.code||e.message)+". Email/Password provider और Admin user जाँचें।",true);}
});
$("fbAdminLogout").addEventListener("click",()=>signOut(auth).catch(e=>status(e.message,true)));
$("fbResetPassword").addEventListener("click",async()=>{
  if(!configured){status("पहले Firebase config सेट करें।",true);return;}
  const email=$("fbAdminEmail").value.trim();if(!email){status("पहले Admin email भरें।",true);return;}
  try{await sendPasswordResetEmail(auth,email);status("Password reset email भेज दिया गया।");}catch(e){status("Reset email नहीं भेजा जा सका: "+e.message,true);}
});
$("fbDownloadTemplate").addEventListener("click",()=>download("bijlibabu-master-template.csv",'division,SDO_CODE,category,consumers,billed,collection,arrears,feeder,substation\r\nAkbarpur,SDO2920231,LMV-1,0,0,0,0,,Akbarpur\r\nPukhrayan,SDO2920232,LMV-1,0,0,0,0,,Pukhrayan',"text/csv;charset=utf-8"));
$("fbPreviewUpload").addEventListener("click",async()=>{
  const file=$("fbMasterFile").files[0];if(!file){previewStatus("पहले CSV, Excel या JSON फ़ाइल चुनें।",true);return;}
  try{pendingRows=await readFileRows(file);renderPreview(pendingRows);previewStatus(`Validation सफल: ${pendingRows.length.toLocaleString("en-IN")} records. पहले 30 preview rows दिखाई गई हैं। Publish Online दबाने पर सभी users के लिए नया version active होगा।`);$("fbPublishMaster").disabled=!currentUser;}
  catch(e){pendingRows=null;$("fbPublishMaster").disabled=true;previewStatus("Validation failed: "+e.message,true);}
});
$("fbPublishMaster").addEventListener("click",async()=>{
  if(!currentUser){previewStatus("पहले Admin Login करें।",true);return;}
  if(!pendingRows?.length){previewStatus("पहले Preview & Validate करें।",true);return;}
  const btn=$("fbPublishMaster");btn.disabled=true;
  try{
    const version=`v_${Date.now()}`;
    const versionRef=doc(db,"masterVersions",version);
    const chunks=[];
    // Small documents keep each Firestore document safely below the 1 MiB document limit.
    for(let i=0;i<pendingRows.length;i+=75)chunks.push({chunkIndex:chunks.length,rows:pendingRows.slice(i,i+75)});
    const totalBatches=Math.ceil(chunks.length/300);
    for(let b=0;b<totalBatches;b++){
      const batch=writeBatch(db);
      chunks.slice(b*300,(b+1)*300).forEach(c=>batch.set(doc(db,"masterVersions",version,"chunks",String(c.chunkIndex).padStart(6,"0")),{chunkIndex:c.chunkIndex,rows:c.rows}));
      await batch.commit();
      previewStatus(`Upload चल रहा है: ${Math.min((b+1)*300,chunks.length).toLocaleString("en-IN")} / ${chunks.length.toLocaleString("en-IN")} chunks`);
    }
    await setDoc(versionRef,{version,recordCount:pendingRows.length,chunkCount:chunks.length,updatedBy:currentUser.email||currentUser.uid,updatedAt:serverTimestamp()});
    // Change the active pointer only after every chunk has been uploaded successfully.
    await setDoc(doc(db,"masterControl","current"),{activeVersion:version,recordCount:pendingRows.length,updatedBy:currentUser.email||currentUser.uid,updatedAt:serverTimestamp()});
    latestRows=pendingRows.slice();latestMeta={version,updatedBy:currentUser.email||currentUser.uid};
    window.dispatchEvent(new CustomEvent("aibijlibabu-cloud-master-loaded",{detail:{rows:latestRows,updatedBy:latestMeta.updatedBy,updatedAt:new Date().toLocaleString("en-IN")}}));
    $("fbCloudMeta").textContent=`Latest online version: ${version} · ${latestRows.length.toLocaleString("en-IN")} records · just published`;
    previewStatus(`सफलतापूर्वक प्रकाशित: ${latestRows.length.toLocaleString("en-IN")} records. सभी visitors अब नया active version पढ़ेंगे।`);
    $("fbBackupMaster").disabled=false;
  }catch(e){console.error(e);previewStatus("Publish असफल: "+(e.code||e.message)+". Firestore Rules में Admin UID और database setup जाँचें।",true);}
  finally{btn.disabled=!currentUser;}
});
$("fbBackupMaster").addEventListener("click",()=>{
  if(!latestRows.length){previewStatus("Backup के लिए Cloud Master Data load नहीं हुआ।",true);return;}
  download("aibijlibabu-cloud-master-backup.json",JSON.stringify({exportedAt:new Date().toISOString(),recordCount:latestRows.length,rows:latestRows},null,2),"application/json");
});
if(!configured){
  status("Firebase setup बाकी है: firebase-config.js में Project settings से Web App config भरें।");
  $("fbConnectionBadge").textContent="Setup required";
}else{
  try{
    const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
    onAuthStateChanged(auth,user=>setSignedIn(user));
    loadPublishedMaster();
  }catch(e){status("Firebase initialize नहीं हुआ: "+e.message,true);}
}
