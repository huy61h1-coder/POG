"use client";
/* eslint-disable @next/next/no-img-element -- POG uploads are served dynamically by the Node API. */

import { useCallback, useEffect, useRef, useState } from "react";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type Tab = "DASHBOARD" | "MAP" | "PRODUCTS" | "CHECK_STOCK" | "STOCK" | "LOSS" | "DATE" | "ORDER" | "SUGGEST";
type Product = { id:string; sku:string; name:string; division:string; divisionName:string; department:string; departmentName:string; supplierBarcode:string; barcode:string; imageUrl?:string; line:string; lineName:string; side:"A"|"B"; bay:number; price:number; stock:number; sales?:number; stockKnown?:boolean; loss:number; expDate:string; updatedAt?:number };
type PickItem = Product & { pickId:string; quantity:number; picked:boolean|number; available?:boolean; customerName:string; note:string; assignedBy:string };
type AssignedPickItem = PickItem & { assigneeId:string; assigneeName:string };
type Actor = { userId:string; username:string; email:string; name:string; role:Role; active:boolean };
type Audit = { id:string; action:string; userId:string; userName:string; createdAt:number };
type UserRole = { userId:string; username:string; email:string; name:string; role:Role; active:boolean; createdAt:number; updatedAt?:number };
type PogFile = { id:string; line:string; side:"A"|"B"; fileName:string; mimeType:string; updatedAt:number };
type LineConfig = { line:string; name:string; color:string; logo:string; updatedAt?:number };
type AiSuggestion = { productId:string; sku:string; name:string; line:string; side:"A"|"B"; bay:number; price:number; stock:number; quantity:number; reason:string };
type AiSuggestionResult = { mode:"ai"|"local"; model:string|null; summary:string; notice:string; items:AiSuggestion[]; productCount:number };
type MasterImportResult = { fileName:string; created:number; updated:number; unchanged:number; imported:number; totalProducts:number; skipped:number; duplicates:number; issues:Array<{row:number;reason:string}> };
type MasterImportJob = { jobId:string; status:"uploading"|"queued"|"processing"|"completed"|"failed"; phase:string; percent:number; processedRows:number; totalRows:number; fileName:string; result:MasterImportResult|null; error:string; updatedAt?:number };
type StockImportJob = Omit<MasterImportJob,"result"> & {result:{fileName:string;imported:number;skipped:number;duplicates:number;issues:Array<{row:number;reason:string}>}|null};
type ProductStats = { total:number; outCount:number; lowCount:number; totalLoss:number; expiring:number };
type StoreData = { actor:Actor; products:Product[]; productTotal:number; productStats:ProductStats; alertProducts:Product[]; availableLines:string[]; logs:Audit[]; picking:PickItem[]; assignedPicking:AssignedPickItem[]; users:UserRole[]; pogFiles:PogFile[]; lineConfigs?:LineConfig[]; manualChecks:{stock:Product[];loss:Product[];expiry:Product[]}; stockImport?:{fileName:string;updatedAt:number;recordCount:number;skipped:number}|null };
type ProductPage = { products:Product[]; total:number; page:number; pageSize:number; matchedLines?:string[] };

const aisleNames: Record<string,string> = {
  "01":"Souvenir","02":"Chocolate","03":"Fruit","04":"Confectionery","05":"Milk","06":"Milk","07":"Kids","08":"Kids",
  "09":"Nonfood","10":"Home Coordy","11":"Home Coordy","12":"Household","13":"Household","14":"Nonfood","15":"Nonfood",
  "16":"Nonfood","17":"Beer & Liquor","18":"Tea & Drinks","19":"Coffee","20":"Topvalu","21":"Topvalu","22":"Asia",
  "23":"Asia","24":"Noodles","25":"Rice","26":"Sauces","27":"Spices","28":"Seafood"
};
const menu: Array<{id:Tab;label:string;icon:string}> = [
  {id:"DASHBOARD",label:"Tổng quan",icon:"◫"},{id:"MAP",label:"Sơ đồ POG",icon:"▦"},{id:"PRODUCTS",label:"Sản phẩm",icon:"▤"},
  {id:"CHECK_STOCK",label:"Check Stock",icon:"▤"},{id:"STOCK",label:"Kiểm tồn",icon:"□"},{id:"LOSS",label:"Thất thoát",icon:"△"},{id:"DATE",label:"Hạn dùng",icon:"◷"},
  {id:"ORDER",label:"Đơn soạn",icon:"✓"},{id:"SUGGEST",label:"Gợi ý",icon:"✦"}
];
const emptyProduct: Product = { id:"",sku:"",name:"",division:"",divisionName:"",department:"",departmentName:"",supplierBarcode:"",barcode:"",line:"01",lineName:"SOUVENIR",side:"A",bay:1,price:0,stock:0,loss:0,expDate:"" };
const money = new Intl.NumberFormat("vi-VN");
const normalize = (value:string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const canManage = (role?:Role) => role === "ADMIN" || role === "MANAGER";

function expiryStatus(value:string) {
  if (!value) return {label:"Chưa có HSD",tone:"muted"};
  const days = Math.ceil((new Date(value + "T00:00:00").getTime() - new Date().setHours(0,0,0,0)) / 86400000);
  if (days < 0) return {label:"Đã hết hạn",tone:"danger"};
  if (days <= 30) return {label:"Còn " + days + " ngày",tone:"warning"};
  return {label:"An toàn",tone:"success"};
}

function StockBadge({stock,known=true}:{stock:number;known?:boolean}) {
  if(!known)return <span className="badge muted">Chưa tải tồn</span>;
  return <span className={"badge " + (stock === 0 ? "danger" : stock < 10 ? "warning" : "success")}>{stock === 0 ? "Hết hàng" : stock < 10 ? "Sắp hết · " + stock : "Còn hàng · " + stock}</span>;
}

function BarcodeScannerModal({onClose,onDetected,onError}:{onClose:()=>void;onDetected:(value:string)=>void;onError:(message:string)=>void}) {
  const videoRef=useRef<HTMLVideoElement>(null),streamRef=useRef<MediaStream|null>(null),frameRef=useRef<number>(0),zxingRef=useRef<{stop:()=>void}|null>(null);
  const [status,setStatus]=useState("Đang mở camera…");const [manual,setManual]=useState("");
  useEffect(()=>{
    let stopped=false;
    const stop=()=>{if(frameRef.current)cancelAnimationFrame(frameRef.current);zxingRef.current?.stop();zxingRef.current=null;streamRef.current?.getTracks().forEach((track)=>track.stop());streamRef.current=null;};
    const start=async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia)throw new Error("Trình duyệt không hỗ trợ camera. Hãy dùng máy quét USB hoặc nhập mã.");
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});if(stopped){stream.getTracks().forEach((track)=>track.stop());return;}
        streamRef.current=stream;const video=videoRef.current;if(!video)return;video.srcObject=stream;await video.play();
        const Detector=(window as unknown as {BarcodeDetector?:new(options?:{formats?:string[]})=>{detect:(source:ImageBitmapSource)=>Promise<Array<{rawValue?:string}>>}}).BarcodeDetector;
        if(!Detector){setStatus("Đang tải bộ nhận diện barcode…");const {BrowserMultiFormatReader}=await import("@zxing/browser");if(stopped)return;const reader=new BrowserMultiFormatReader();setStatus("Đang nhận diện barcode…");const controls=await reader.decodeFromStream(stream,video,(result)=>{const value=result?.getText();if(value){stop();onDetected(value);}});if(!stopped)zxingRef.current=controls;return;}
        const detector=new Detector({formats:["ean_13","ean_8","code_128","code_39","upc_a","upc_e","qr_code"]});setStatus("Đưa barcode vào giữa khung hình…");
        const scan=async()=>{if(stopped||!videoRef.current)return;try{const found=await detector.detect(videoRef.current);const value=found.find((item)=>item.rawValue)?.rawValue;if(value){stop();onDetected(value);return;}}catch{ /* next frame can retry */ }frameRef.current=requestAnimationFrame(()=>void scan());};void scan();
      } catch(cause) { const message=cause instanceof Error?cause.message:"Không thể mở camera";setStatus(message);onError(message); }
    };
    void start();return()=>{stopped=true;stop();};
  },[onDetected,onError]);
  return <div className="modal-backdrop barcode-modal"><section className="scanner-card" role="dialog" aria-modal="true" aria-label="Quét barcode"><div className="modal-head"><div><p>QUÉT SẢN PHẨM</p><h2>Quét barcode</h2></div><button onClick={onClose}>×</button></div><div className="scanner-video"><video ref={videoRef} muted playsInline/><span className="scanner-frame"/></div><p>{status}</p><form className="scanner-manual" onSubmit={(event)=>{event.preventDefault();if(manual.trim())onDetected(manual.trim());}}><input value={manual} onChange={(event)=>setManual(event.target.value)} placeholder="Hoặc nhập / quét bằng máy quét USB"/><button className="primary" disabled={!manual.trim()}>Tìm</button></form><button className="ghost scanner-close" onClick={onClose}>Đóng</button></section></div>;
}

export default function Home() {
  const [data,setData] = useState<StoreData|null>(null);
  const [authMode,setAuthMode] = useState<"login"|"setup"|null>(null);
  const [tab,setTab] = useState<Tab>("DASHBOARD");
  const [query,setQuery] = useState("");
  const [stockFilter,setStockFilter] = useState<"all"|"available"|"low"|"out">("all");
  const [lineFilter,setLineFilter] = useState("all");
  const [lastSyncedAt,setLastSyncedAt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [productModal,setProductModal] = useState<Product|null>(null);
  const [assignmentProduct,setAssignmentProduct] = useState<Product|null>(null);
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [lineModal,setLineModal] = useState<LineConfig|null>(null);
  const [pogModal,setPogModal] = useState<{line:string;side:"A"|"B";selectedId?:string}|null>(null);
  const [pogSearch,setPogSearch] = useState("");
  const [suggestInput,setSuggestInput] = useState("");
  const [suggestResult,setSuggestResult] = useState<AiSuggestionResult|null>(null);
  const [suggestBusy,setSuggestBusy] = useState(false);
  const [suggestError,setSuggestError] = useState("");
  const [scannerOpen,setScannerOpen] = useState(false);
  const [masterImport,setMasterImport] = useState<MasterImportResult|null>(null);
  const [importJob,setImportJob] = useState<MasterImportJob|null>(null);
  const [stockImportJob,setStockImportJob] = useState<StockImportJob|null>(null);
  const [productResult,setProductResult] = useState<ProductPage>({products:[],total:0,page:1,pageSize:100});
  const [productResultKey,setProductResultKey] = useState("");
  const [productPage,setProductPage] = useState(1);
  const [productRefresh,setProductRefresh] = useState(0);
  const [productsBusy,setProductsBusy] = useState(false);
  const [pogProducts,setPogProducts] = useState<Product[]>([]);
  const [pogTotal,setPogTotal] = useState(0);
  const [pogResultKey,setPogResultKey] = useState("");
  const [theme,setTheme] = useState(()=>{if(typeof window==="undefined")return "aeon";const saved=window.localStorage.getItem("fulfillment-theme");return ["aeon","aeon-soft","graphite"].includes(saved||"")?saved!:"aeon"});
  const excelRef = useRef<HTMLInputElement>(null);
  const stockExcelRef = useRef<HTMLInputElement>(null);
  const pogRef = useRef<HTMLInputElement>(null);
  const searchCacheRef = useRef(new Map<string,ProductPage>());
  const actorUserId=data?.actor.userId,pogLine=pogModal?.line,pogSide=pogModal?.side,importStorageKey=actorUserId?"fulfillment-master-job:"+actorUserId:"";

  const loadData = useCallback(async (quiet=false) => {
    if (!quiet) setBusy(true);
    try {
      const response = await fetch("/api/store?includeProducts=0", { cache:"no-store" });
      const payload = await response.json() as StoreData & {error?:string;setupRequired?:boolean};
      if(response.status===401){setData(null);setAuthMode(payload.setupRequired?"setup":"login");setError("");return;}
      if (!response.ok) throw new Error(payload.error || "Không thể tải dữ liệu");
      setData(payload);setAuthMode(null);setError("");setLastSyncedAt(Date.now());
      const saved=window.localStorage.getItem("fulfillment-master-job:"+payload.actor.userId);if(saved)setImportJob((current)=>current||{jobId:saved,status:"queued",phase:"Đang khôi phục tiến độ nhập dữ liệu",percent:5,processedRows:0,totalRows:0,fileName:"Master Data",result:null,error:""});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu"); }
    finally { if (!quiet) setBusy(false); }
  },[]);

  useEffect(() => {
    if(authMode)return;
    const initial = window.setTimeout(() => void loadData(),0);
    const timer = window.setInterval(() => void loadData(true),15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  },[loadData,authMode]);
  useEffect(() => { document.documentElement.dataset.theme=theme; window.localStorage.setItem("fulfillment-theme",theme); },[theme]);
  useEffect(() => { if (!toast) return; const timer=window.setTimeout(()=>setToast(""),2600); return ()=>window.clearTimeout(timer); },[toast]);
  useEffect(()=>{
    if(!actorUserId)return;
    if(query.trim().length===1)return;
    const requestKey=[tab,query.trim(),lineFilter,stockFilter,productPage,productRefresh].join("|");
    const controller=new AbortController(),timer=window.setTimeout(async()=>{
      setProductsBusy(true);
      try {
        const params=new URLSearchParams({page:String(productPage),pageSize:"100",stock:tab==="MAP"?"all":stockFilter});
        if(query.trim())params.set("q",query.trim());if(tab!=="MAP"&&lineFilter!=="all")params.set("line",lineFilter);if(tab==="DATE")params.set("sort","expiry");
        const endpoint=(tab==="CHECK_STOCK"?"/api/stock?":"/api/products?")+params,cacheKey=endpoint;
        const cached=searchCacheRef.current.get(cacheKey);if(cached){setProductResult(cached);setProductResultKey(requestKey);setProductsBusy(false);return;}
        const response=await fetch(endpoint,{cache:"no-store",signal:controller.signal}),payload=await response.json() as ProductPage&{error?:string};
        if(!response.ok)throw new Error(payload.error||"Không thể tải danh sách sản phẩm");
        if(searchCacheRef.current.size>80)searchCacheRef.current.delete(searchCacheRef.current.keys().next().value as string);searchCacheRef.current.set(cacheKey,payload);
        setProductResult(payload);setProductResultKey(requestKey);
        const lastPage=Math.max(1,Math.ceil(payload.total/payload.pageSize));if(productPage>lastPage)setProductPage(lastPage);
      } catch(cause){if(!controller.signal.aborted)setToast(cause instanceof Error?cause.message:"Không thể tải danh sách sản phẩm");}
      finally{if(!controller.signal.aborted)setProductsBusy(false);}
    },query.trim()?260:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[actorUserId,query,lineFilter,stockFilter,productPage,productRefresh,tab]);
  useEffect(()=>{
    if(!actorUserId||!pogLine||!pogSide)return;
    const requestKey=[actorUserId,pogLine,pogSide,pogSearch.trim(),productRefresh].join("|");
    const controller=new AbortController(),timer=window.setTimeout(async()=>{
      const params=new URLSearchParams({line:pogLine,side:pogSide,pageSize:"200"});if(pogSearch.trim())params.set("q",pogSearch.trim());
      try{const response=await fetch("/api/products?"+params,{cache:"no-store",signal:controller.signal}),payload=await response.json() as ProductPage;if(response.ok){setPogProducts(payload.products);setPogTotal(payload.total);setPogResultKey(requestKey);}}catch(cause){void cause}
    },pogSearch.trim()?180:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[actorUserId,pogLine,pogSide,pogSearch,productRefresh]);
  useEffect(()=>{
    const jobId=importJob?.jobId;if(!actorUserId||!jobId||importJob.status==="uploading"||["completed","failed"].includes(importJob.status))return;
    let stopped=false,timer=0,failures=0;
    const poll=async()=>{
      try{
        const response=await fetch("/api/master-data/import/"+encodeURIComponent(jobId),{cache:"no-store"}),payload=await response.json() as MasterImportJob&{error?:string};
        if(response.status===401){setData(null);setAuthMode("login");return;}
        if(!response.ok){const cause=new Error(payload.error||"Không thể theo dõi tiến độ nhập dữ liệu") as Error&{terminal?:boolean};cause.terminal=[403,404].includes(response.status);throw cause;}
        failures=0;
        if(stopped)return;setImportJob(payload);
        if(payload.status==="completed"&&payload.result){setMasterImport(payload.result);window.localStorage.removeItem(importStorageKey);setProductPage(1);setProductRefresh((value)=>value+1);void loadData(true);setToast("Đã nhập "+payload.result.imported+" SKU · "+payload.result.created+" mới · "+payload.result.updated+" cập nhật");return;}
        if(payload.status==="failed"){window.localStorage.removeItem(importStorageKey);setToast(payload.error||"Không thể nhập Master Data");return;}
        timer=window.setTimeout(()=>void poll(),900);
      }catch(cause){if(!stopped){const error=cause as Error&{terminal?:boolean};if(error.terminal){setImportJob((current)=>current?{...current,status:"failed",phase:"Không thể tiếp tục",error:error.message}:current);window.localStorage.removeItem(importStorageKey);return;}failures++;setImportJob((current)=>current?{...current,phase:"Mất kết nối tạm thời · đang thử lại",error:error.message}:current);timer=window.setTimeout(()=>void poll(),Math.min(10000,900*2**Math.min(4,failures)));}}
    };
    void poll();return()=>{stopped=true;window.clearTimeout(timer);};
  },[actorUserId,importJob?.jobId,importJob?.status,importStorageKey,loadData]);
  useEffect(()=>{
    const jobId=stockImportJob?.jobId;if(!actorUserId||!jobId||stockImportJob.status==="uploading"||["completed","failed"].includes(stockImportJob.status))return;
    let stopped=false,timer=0;
    const poll=async()=>{try{const response=await fetch("/api/stock/import/"+encodeURIComponent(jobId),{cache:"no-store"}),payload=await response.json() as StockImportJob&{error?:string};if(!response.ok)throw new Error(payload.error||"Không thể theo dõi file Stock");if(stopped)return;setStockImportJob(payload);if(payload.status==="completed"){setProductPage(1);setProductRefresh((value)=>value+1);void loadData(true);setToast("Đã cập nhật tồn kho từ "+(payload.result?.imported||0)+" SKU");return;}if(payload.status==="failed"){setToast(payload.error||"Không thể nhập file Stock");return;}timer=window.setTimeout(()=>void poll(),900);}catch(cause){if(!stopped){setStockImportJob((current)=>current?{...current,phase:"Mất kết nối tạm thời · đang thử lại",error:cause instanceof Error?cause.message:""}:current);timer=window.setTimeout(()=>void poll(),3000);}}};void poll();return()=>{stopped=true;window.clearTimeout(timer);};
  },[actorUserId,stockImportJob?.jobId,stockImportJob?.status,loadData]);

  const mutate = async (action:string, payload:Record<string,unknown>={}) => {
    setBusy(true);
    try {
      const response = await fetch("/api/store",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...payload})});
      const result = await response.json() as {error?:string;setupRequired?:boolean};
      if(response.status===401){setData(null);setAuthMode(result.setupRequired?"setup":"login");throw new Error("Phiên đăng nhập đã hết hạn");}
      if (!response.ok) throw new Error(result.error || "Thao tác thất bại");
      await loadData(true);setProductRefresh((value)=>value+1);setToast("Đã cập nhật thành công");
      return true;
    } catch (cause) { setToast(cause instanceof Error ? cause.message : "Thao tác thất bại"); return false; }
    finally { setBusy(false); }
  };

  const authenticate = async (credentials:{username:string;password:string;name?:string}) => {
    if(!authMode)return;
    setBusy(true);setError("");
    try {
      const response=await fetch(authMode==="setup"?"/api/auth/setup":"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(credentials)});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error||"Không thể đăng nhập");
      await loadData(true);
    } catch(cause){setError(cause instanceof Error?cause.message:"Không thể đăng nhập");}
    finally{setBusy(false);}
  };

  const logout = async () => {
    setBusy(true);
    try{await fetch("/api/auth/logout",{method:"POST"});}finally{setSettingsOpen(false);setImportJob(null);setData(null);setAuthMode("login");setBusy(false);}
  };

  const productRequestKey=[tab,query.trim(),lineFilter,stockFilter,productPage,productRefresh].join("|"),productsCurrent=productResultKey===productRequestKey;
  const products=productsCurrent?productResult.products:[],productsLoading=productsBusy||!productsCurrent;
  const searchMatches = query.length >= 2 ? products.slice(0,8) : [];
  const pickedCount = (data?.picking||[]).filter((p)=>Boolean(p.picked)).length;
  const progress = data?.picking?.length ? Math.round(pickedCount/data.picking.length*100) : 0;
  const activePog = pogModal ? data?.pogFiles.find((file)=>file.id===pogModal.line+"_"+pogModal.side) : undefined;
  const pogRequestKey=[actorUserId||"",pogLine||"",pogSide||"",pogSearch.trim(),productRefresh].join("|"),pogCurrent=pogResultKey===pogRequestKey;
  const visiblePogProducts=pogCurrent?pogProducts:[],visiblePogTotal=pogCurrent?pogTotal:0;
  const availableLines=data?.availableLines||[];
  const importActive=Boolean(importJob&&["uploading","queued","processing"].includes(importJob.status));
  const totalPages=Math.max(1,Math.ceil(productResult.total/productResult.pageSize));

  const exportCsv = () => {
    const link=document.createElement("a");link.href="/api/master-data/export.csv";link.download="MasterData_Fulfillment.csv";document.body.appendChild(link);link.click();link.remove();
  };
  const importExcel = async (file?:File) => {
    if(!file||importActive)return;
    const jobId=crypto.randomUUID(),form=new FormData();form.set("file",file);
    setMasterImport(null);setTab("PRODUCTS");setProductPage(1);setImportJob({jobId,status:"uploading",phase:"Đang tải file Excel lên máy chủ",percent:0,processedRows:0,totalRows:0,fileName:file.name,result:null,error:""});
    if(importStorageKey)window.localStorage.setItem(importStorageKey,jobId);
    try {
      const result=await new Promise<MasterImportJob>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();xhr.open("POST","/api/master-data/import");xhr.timeout=10*60_000;xhr.setRequestHeader("x-import-id",jobId);
        xhr.upload.onprogress=(event)=>{if(event.lengthComputable)setImportJob((current)=>current?{...current,percent:Math.min(10,Math.round(event.loaded/event.total*10))}:current);};
        xhr.onerror=()=>reject(new Error("Mất kết nối khi tải file Excel"));
        xhr.ontimeout=()=>reject(new Error("Tải file quá lâu · hệ thống sẽ tự kiểm tra lại trạng thái"));xhr.onabort=()=>reject(new Error("Đã dừng tải file Excel"));
        xhr.onload=()=>{let payload:MasterImportJob&{error?:string};try{payload=JSON.parse(xhr.responseText);}catch{reject(new Error("Máy chủ trả về dữ liệu không hợp lệ"));return;}if(xhr.status!==202){const cause=new Error(payload.error||"Không thể nhập Master Data") as Error&{terminal?:boolean};cause.terminal=xhr.status>=400&&xhr.status<500;reject(cause);return;}resolve(payload);};
        xhr.send(form);
      });
      setImportJob(result);
    } catch(cause){const error=cause as Error&{terminal?:boolean};if(error.terminal){if(importStorageKey)window.localStorage.removeItem(importStorageKey);setImportJob((current)=>current?{...current,status:"failed",phase:"Tải file thất bại",error:error.message}:current);}else setImportJob((current)=>current?{...current,status:"queued",phase:"Đang kiểm tra file đã nhận trên máy chủ",error:error.message}:current);setToast(error.message||"Không thể nhập Master Data");}
    finally{if(excelRef.current)excelRef.current.value="";}
  };
  const importStockExcel=async(file?:File)=>{
    if(!file||stockImportJob&&["uploading","queued","processing"].includes(stockImportJob.status))return;
    setStockImportJob({jobId:"",status:"uploading",phase:"Đang tải file Stock",percent:5,processedRows:0,totalRows:0,fileName:file.name,result:null,error:""});
    try{const form=new FormData();form.set("file",file);const response=await fetch("/api/stock/import",{method:"POST",body:form}),payload=await response.json() as StockImportJob&{error?:string};if(!response.ok)throw new Error(payload.error||"Không thể nhập file Stock");setStockImportJob(payload);}catch(cause){setStockImportJob(null);setToast(cause instanceof Error?cause.message:"Không thể nhập file Stock");}finally{if(stockExcelRef.current)stockExcelRef.current.value="";}
  };
  const addManualCheck=(kind:"stock"|"loss"|"expiry")=>{
    const sku=window.prompt("Nhập SKU trong Master Data:");if(!sku?.trim())return;
    const label=kind==="stock"?"Số lượng kiểm đếm":kind==="loss"?"Số lượng thất thoát":"Hạn sử dụng (YYYY-MM-DD)";
    const value=window.prompt(label);if(value===null||!value.trim())return;void mutate("setManualCheck",{kind,sku,value});
  };

  const openProductOnMap = (product:Product) => { setPogModal({line:product.line,side:product.side,selectedId:product.id});setPogSearch(product.sku);setQuery("");setProductPage(1); };
  const quickAdd = async (product:Product) => { if(product.stock===0){setToast("Sản phẩm đang hết hàng");return;}if(await mutate("addPick",{productId:product.id,quantity:1})){setQuery("");setProductPage(1);} };
  const handleBarcode = async (rawValue:string) => { const value=rawValue.trim(),needle=normalize(value);if(!value)return;try{const response=await fetch("/api/products?"+new URLSearchParams({q:value,page:"1",pageSize:"8"}),{cache:"no-store"}),payload=await response.json() as ProductPage&{error?:string};if(!response.ok)throw new Error(payload.error||"Không thể tìm sản phẩm");const exact=payload.products.find((p)=>normalize(p.sku)===needle||normalize(p.barcode)===needle||normalize(p.supplierBarcode)===needle);if(exact)await quickAdd(exact);else if(payload.products[0])openProductOnMap(payload.products[0]);else setToast("Không tìm thấy SKU hoặc barcode");}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tìm sản phẩm");} };
  const handleSearchEnter = async () => { await handleBarcode(query); };
  const uploadPog = async (file?:File) => {
    if(!file||!pogModal)return; setBusy(true);
    try { const form=new FormData();form.set("file",file);form.set("line",pogModal.line);form.set("side",pogModal.side);
      const response=await fetch("/api/pog",{method:"POST",body:form});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||"Không thể tải POG");
      await loadData(true);setToast("Đã cập nhật POG "+pogModal.line+pogModal.side);
    } catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tải POG");} finally{setBusy(false);if(pogRef.current)pogRef.current.value="";}
  };
  const generateSuggestions = async () => {
    const value=suggestInput.trim();
    if(value.length<2){setSuggestError("Hãy mô tả nhu cầu để AI có thể phân tích.");return;}
    setSuggestBusy(true);setSuggestError("");
    try {
      const response=await fetch("/api/ai/suggest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:value})});
      const payload=await response.json() as AiSuggestionResult&{error?:string};
      if(!response.ok)throw new Error(payload.error||"Không thể phân tích lúc này.");
      setSuggestResult(payload);
    } catch(cause){setSuggestError(cause instanceof Error?cause.message:"Không thể phân tích lúc này.");}
    finally{setSuggestBusy(false);}
  };
  const openSuggested=async(item:AiSuggestion)=>{try{const response=await fetch("/api/products?id="+encodeURIComponent(item.productId),{cache:"no-store"}),payload=await response.json() as ProductPage&{error?:string};if(!response.ok||!payload.products[0])throw new Error(payload.error||"Sản phẩm không còn trong danh sách");openProductOnMap(payload.products[0]);}catch(cause){setToast(cause instanceof Error?cause.message:"Sản phẩm không còn trong danh sách");}};
  const addSuggested=async(item:AiSuggestion)=>{if(item.stock===0){setToast("Sản phẩm đang hết hàng");return;}await mutate("addPick",{productId:item.productId,quantity:item.quantity});};

  if (!data && authMode) return <AuthScreen mode={authMode} busy={busy} error={error} onSubmit={authenticate}/>;
  if (!data && busy) return <main className="loading-screen"><div className="spinner"/><b>Đang đồng bộ dữ liệu cửa hàng…</b></main>;
  if (!data && error) return <main className="loading-screen"><b>Không thể mở dữ liệu</b><p>{error}</p><button onClick={()=>void loadData()}>Thử lại</button></main>;
  if (!data) return null;

  return (
    <main className="ops-shell">
      {toast&&<div className="toast">{toast}</div>}
      {busy&&<div className="busy-line"/>}
      <header className="ops-topbar">
        <button className="ops-brand" onClick={()=>{setTab("DASHBOARD");setProductPage(1);}}><b>AEON</b><span>FULFILLMENT<br/>SMARTOPS</span></button>
        <div className="global-search">
          <span>⌕</span><input value={query} onChange={(e)=>{setQuery(e.target.value);setProductPage(1);}} onKeyDown={(e)=>{if(e.key==="Enter")void handleSearchEnter()}} placeholder="Tìm hoặc quét SKU, barcode…" />
          <button className="barcode-trigger" title="Quét barcode bằng camera" aria-label="Quét barcode bằng camera" onClick={()=>setScannerOpen(true)}>▣</button>
          {query&&<button onClick={()=>{setQuery("");setProductPage(1);}}>×</button>}
          {query.length>=2&&<div className="search-popover">{productsLoading?<div className="search-empty"><i className="mini-spinner"/><b>Đang tìm sản phẩm…</b></div>:<>{searchMatches.map((p)=><article key={p.id}><button className="search-result-main" onClick={()=>openProductOnMap(p)}><span><b>{p.name}</b><small>SKU {p.sku} · Line {p.line}{p.side} · Kệ {p.bay}</small></span><StockBadge stock={p.stock}/></button><button className="search-quick-add" disabled={p.stock===0} onClick={()=>void quickAdd(p)}>+ Đơn</button></article>)}{!searchMatches.length&&<div className="search-empty"><b>Không tìm thấy sản phẩm</b><span>Kiểm tra lại SKU, barcode hoặc tên hàng.</span></div>}</>}</div>}
        </div>
        <button className="top-order" onClick={()=>{setTab("ORDER");setProductPage(1);}}><span>ĐƠN SOẠN</span><b>{pickedCount}/{data.picking.length}</b><i><em style={{width:progress+"%"}}/></i></button>
        {importActive&&<button className="import-job-chip" onClick={()=>{setTab("PRODUCTS");setProductPage(1);}} title={importJob?.phase}><i/><span>Đang nhập Excel<b>{Math.round(importJob?.percent||0)}%</b></span></button>}
        <div className={"sync-chip "+(error?"offline":"online")} title={error||"Dữ liệu được tự động cập nhật mỗi 15 giây"}><i/>{error?"Mất kết nối":lastSyncedAt?"Đã đồng bộ":"Đang nối"}</div>
        <button className="user-chip" onClick={()=>setSettingsOpen(true)}><span>{data.actor.name.slice(0,2).toUpperCase()}</span><b>{data.actor.name}<small>{data.actor.role}</small></b></button>
      </header>

      <div className="ops-body">
        <nav className="side-nav">{menu.map((item)=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>{setTab(item.id);setProductPage(1);}}><span>{item.icon}</span>{item.label}{item.id==="ORDER"&&data.picking.length>0?<b>{data.picking.length}</b>:null}</button>)}</nav>
        <section className="ops-content">
          {(["PRODUCTS","CHECK_STOCK"] as Tab[]).includes(tab)&&<OpsFilters lines={availableLines} line={lineFilter} stock={stockFilter} visible={products.length} total={productResult.total} onLine={(value)=>{setLineFilter(value);setProductPage(1);}} onStock={(value)=>{setStockFilter(value);setProductPage(1);}} onClear={()=>{setQuery("");setLineFilter("all");setStockFilter("all");setProductPage(1);}}/>}
          {tab==="DASHBOARD"&&<Dashboard products={data.alertProducts} totalProducts={data.productTotal} logs={data.logs} totals={data.productStats} onGo={(next)=>{setTab(next);setProductPage(1);}}/>}
          {tab==="MAP"&&<MapView products={products} matchedLines={productResult.matchedLines||[]} lineConfigs={data.lineConfigs||[]} query={query} canManage={canManage(data.actor.role)} onOpen={(line,side)=>setPogModal({line,side})} onEdit={(lineConfig)=>setLineModal(lineConfig)}/>}
          {tab==="PRODUCTS"&&<ProductsView products={products} total={productResult.total} role={data.actor.role} importResult={masterImport} importJob={importJob} onAdd={()=>setProductModal({...emptyProduct})} onEdit={(p)=>setProductModal({...p})} onDelete={(p)=>void mutate("deleteProduct",{id:p.id})} onMap={openProductOnMap} onPick={(p)=>void mutate("addPick",{productId:p.id})} onExport={exportCsv} onImport={()=>excelRef.current?.click()}/>}
          {tab==="CHECK_STOCK"&&<StockCheckView products={products} total={productResult.total} role={data.actor.role} metadata={data.stockImport} job={stockImportJob} onImport={()=>stockExcelRef.current?.click()} onExport={()=>{const link=document.createElement("a");link.href="/api/stock/export.csv";link.click();}} onAssign={(product)=>setAssignmentProduct(product)}/>} 
          {tab==="STOCK"&&<ManualCheckGrid kind="stock" products={data.manualChecks.stock} onAdd={()=>addManualCheck("stock")}/>}
          {tab==="LOSS"&&<ManualCheckGrid kind="loss" products={data.manualChecks.loss} onAdd={()=>addManualCheck("loss")}/>}
          {tab==="DATE"&&<ManualCheckGrid kind="expiry" products={data.manualChecks.expiry} onAdd={()=>addManualCheck("expiry")}/>}
          {(["PRODUCTS","CHECK_STOCK"] as Tab[]).includes(tab)&&<ProductPager page={productPage} pages={totalPages} total={productResult.total} busy={productsLoading} onPage={setProductPage}/>}
          {tab==="ORDER"&&<OrderView items={data.picking} assignedItems={data.assignedPicking} role={data.actor.role} onToggle={(p)=>void mutate("togglePick",{pickId:p.pickId})} onAvailability={(p)=>void mutate("markPickAvailability",{pickId:p.pickId,available:!p.available})} onQuantity={(p,quantity)=>void mutate("updatePickQuantity",{pickId:p.pickId,quantity})} onRemove={(p)=>void mutate("removePick",{pickId:p.pickId})} onClear={()=>void mutate("clearPick")} onMap={openProductOnMap}/>}
          {tab==="SUGGEST"&&<SuggestView value={suggestInput} onValue={setSuggestInput} onGenerate={()=>void generateSuggestions()} result={suggestResult} busy={suggestBusy} error={suggestError} totalProducts={data.productTotal} onMap={(item)=>void openSuggested(item)} onPick={(item)=>void addSuggested(item)}/>}
        </section>
      </div>

      <nav className="mobile-nav">{menu.filter((item)=>(["DASHBOARD","MAP","PRODUCTS","CHECK_STOCK","STOCK","LOSS","DATE","ORDER","SUGGEST"] as Tab[]).includes(item.id)).map((item)=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>{setTab(item.id);setProductPage(1);}}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <input ref={excelRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e)=>void importExcel(e.target.files?.[0])}/>
      <input ref={stockExcelRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e)=>void importStockExcel(e.target.files?.[0])}/>

      {productModal&&<ProductModal value={productModal} onChange={setProductModal} onClose={()=>setProductModal(null)} onSave={async()=>{if(await mutate("upsertProduct",{product:productModal}))setProductModal(null);}}/>}
      {assignmentProduct&&<AssignPickModal product={assignmentProduct} users={data.users.filter((user)=>user.active)} onClose={()=>setAssignmentProduct(null)} onAssign={async(assignment)=>{if(await mutate("assignPick",{productId:assignmentProduct.id,...assignment}))setAssignmentProduct(null);}}/>}
      {settingsOpen&&<SettingsModal actor={data.actor} users={data.users} theme={theme} onTheme={setTheme} onCreate={(account)=>mutate("createAccount",{account})} onUpdate={(account)=>mutate("updateAccount",{account})} onPassword={(currentPassword,newPassword)=>mutate("changeOwnPassword",{currentPassword,newPassword})} onLogout={logout} onClose={()=>setSettingsOpen(false)}/>}
      {lineModal&&<LineConfigModal value={lineModal} onChange={setLineModal} onClose={()=>setLineModal(null)} onSave={async()=>{if(await mutate("updateLineConfig",{lineConfig:lineModal}))setLineModal(null);}}/>}
      {pogModal&&<PogModal modal={pogModal} setModal={setPogModal} products={visiblePogProducts} total={visiblePogTotal} file={activePog} search={pogSearch} setSearch={setPogSearch} canUpload={canManage(data.actor.role)} uploadRef={pogRef} onUpload={(file)=>void uploadPog(file)} onPick={(product)=>void quickAdd(product)} onClose={()=>setPogModal(null)}/>}
      {scannerOpen&&<BarcodeScannerModal onClose={()=>setScannerOpen(false)} onDetected={(value)=>{setScannerOpen(false);setQuery(value);void handleBarcode(value);}} onError={setToast}/>} 
    </main>
  );
}

function AuthScreen({mode,busy,error,onSubmit}:{mode:"login"|"setup";busy:boolean;error:string;onSubmit:(credentials:{username:string;password:string;name?:string})=>Promise<void>}) {
  const [username,setUsername]=useState("");const [password,setPassword]=useState("");const [name,setName]=useState("");
  const setup=mode==="setup",valid=username.trim().length>=3&&password.length>=8&&(!setup||name.trim().length>=2);
  return <main className="auth-screen"><section className="auth-card"><header><b>AEON</b><div><span>FULFILLMENT</span><strong>SMARTOPS</strong></div></header><div className="auth-intro"><p>{setup?"THIẾT LẬP LẦN ĐẦU":"TÀI KHOẢN NHÂN VIÊN"}</p><h1>{setup?"Tạo tài khoản Admin":"Đăng nhập"}</h1><span>{setup?"Tài khoản đầu tiên quản lý sản phẩm, Excel và phân quyền cho nhân viên.":"Đăng nhập để truy cập dữ liệu hàng hóa và đơn soạn của bạn."}</span></div><form onSubmit={(event)=>{event.preventDefault();if(valid&&!busy)void onSubmit({username:username.trim().toLowerCase(),password,name:name.trim()});}}>
    {setup&&<label>Tên hiển thị<input value={name} autoComplete="name" onChange={(event)=>setName(event.target.value)} placeholder="Ví dụ: Nguyễn Văn An"/></label>}
    <label>Tên đăng nhập<input value={username} autoCapitalize="none" autoComplete="username" onChange={(event)=>setUsername(event.target.value)} placeholder="Ví dụ: an.nguyen"/></label>
    <label>Mật khẩu<input type="password" value={password} autoComplete={setup?"new-password":"current-password"} onChange={(event)=>setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự"/></label>
    {error&&<div className="auth-error" aria-live="polite">{error}</div>}
    <button disabled={!valid||busy}>{busy?<><i className="mini-spinner"/>Đang xử lý…</>:setup?"Tạo Admin và bắt đầu":"Đăng nhập"}</button>
  </form>{setup&&<small>Chỉ hiển thị khi hệ thống chưa có tài khoản. Sau khi tạo, Admin có thể thêm Manager và Staff.</small>}</section><aside><span>01</span><b>Master Data rõ ràng</b><p>Tìm kiếm, kiểm tồn và cập nhật sản phẩm từ Excel theo đúng quyền được giao.</p></aside></main>;
}

function PageHead({eyebrow,title,subtitle,actions}:{eyebrow:string;title:string;subtitle:string;actions?:React.ReactNode}) {
  return <div className="page-head"><div><p>{eyebrow}</p><h1>{title}</h1><span>{subtitle}</span></div>{actions&&<div className="head-actions">{actions}</div>}</div>;
}
function OpsFilters({lines,line,stock,visible,total,onLine,onStock,onClear}:{lines:string[];line:string;stock:"all"|"available"|"low"|"out";visible:number;total:number;onLine:(value:string)=>void;onStock:(value:"all"|"available"|"low"|"out")=>void;onClear:()=>void}) {
  return <div className="ops-filters"><label>Line<select value={line} onChange={(e)=>onLine(e.target.value)}><option value="all">Tất cả Line</option>{lines.map((item)=><option key={item} value={item}>Line {item}</option>)}</select></label><div className="filter-chips">{([['all','Tất cả'],['available','Còn hàng'],['low','Tồn thấp'],['out','Hết hàng']] as const).map(([value,label])=><button key={value} className={stock===value?"active":""} onClick={()=>onStock(value)}>{label}</button>)}</div><span>{visible}/{total} sản phẩm</span>{(line!=="all"||stock!=="all")&&<button className="clear-filters" onClick={onClear}>Xóa lọc</button>}</div>;
}
function ProductPager({page,pages,total,busy,onPage}:{page:number;pages:number;total:number;busy:boolean;onPage:(page:number)=>void}) {
  if(total<=100)return busy?<div className="product-loading"><i className="mini-spinner"/>Đang tải sản phẩm…</div>:null;
  return <nav className="product-pager" aria-label="Phân trang sản phẩm"><span>{busy?<><i className="mini-spinner"/>Đang tải…</>:<>{money.format(total)} sản phẩm</>}</span><div><button disabled={busy||page<=1} onClick={()=>onPage(page-1)}>← Trước</button><b>Trang {page}/{pages}</b><button disabled={busy||page>=pages} onClick={()=>onPage(page+1)}>Sau →</button></div></nav>;
}
function Dashboard({products,totalProducts,logs,totals,onGo}:{products:Product[];totalProducts:number;logs:Audit[];totals:ProductStats;onGo:(tab:Tab)=>void}) {
  const cards=[["Cạn kho",totals.outCount,"STOCK","!"],["Tồn thấp",totals.lowCount,"STOCK","↓"],["Thất thoát",totals.totalLoss,"LOSS","△"],["HSD cảnh báo",totals.expiring,"DATE","◷"]] as const;
  const alerts=products.filter((p)=>p.stock<10||p.loss>0||["warning","danger"].includes(expiryStatus(p.expDate).tone)).slice(0,6);
  return <div><PageHead eyebrow="TRUNG TÂM VẬN HÀNH" title="Tổng quan" subtitle={money.format(totalProducts)+" SKU · Tồn kho, thất thoát và hạn dùng được cập nhật đồng bộ."}/>
    <div className="metric-grid">{cards.map((card)=><button key={card[0]} onClick={()=>onGo(card[2])}><i>{card[3]}</i><span>{card[0]}</span><strong>{card[1]}</strong></button>)}</div>
    <div className="dash-grid"><section className="panel"><div className="panel-title"><h2>Cảnh báo cần xử lý</h2><span>{alerts.length} mục</span></div><div className="alert-list">{alerts.map((p)=><article key={p.id}><div className={"line-token line-"+p.line}>{p.line}</div><div><b>{p.name}</b><span>SKU {p.sku} · Tồn {p.stock} · Loss {p.loss}</span></div><StockBadge stock={p.stock}/></article>)}</div></section>
    <section className="panel"><div className="panel-title"><h2>Lịch sử thao tác</h2><span>Real-time</span></div><div className="audit-list">{logs.slice(0,10).map((log)=><article key={log.id}><i/><div><b>{log.action}</b><span>{log.userName} · {new Date(log.createdAt).toLocaleString("vi-VN")}</span></div></article>)}{!logs.length&&<div className="empty">Chưa có thao tác</div>}</div></section></div></div>;
}
function MapView({products,matchedLines,lineConfigs,query,canManage,onOpen,onEdit}:{products:Product[];matchedLines:string[];lineConfigs:LineConfig[];query:string;canManage:boolean;onOpen:(line:string,side:"A"|"B")=>void;onEdit:(lineConfig:LineConfig)=>void}) {
  const topLines=["17","18","19","20","21","22","23","24","25","26","27","28"];
  const bottomLines=["16","15","14","13","12","11","10","09","08","07","06","05","04","03","02","01"];
  const configByLine=new Map(lineConfigs.map((config)=>[config.line,config]));
  const matched=new Set(matchedLines.length?matchedLines:products.filter((p)=>!query||normalize([p.name,p.sku,p.barcode,p.line,p.side,configByLine.get(p.line)?.name||aisleNames[p.line]].join(" ")).includes(normalize(query))).map((p)=>p.line));
  const LineCard=({line}:{line:string})=>{const config=configByLine.get(line)||{line,name:aisleNames[line],color:"#62676A",logo:""};const hit=matched.has(line)&&Boolean(query);return <section className={`layout-line line-${line}${hit?" match":""}`} style={{"--line":config.color,"--body":`color-mix(in srgb, ${config.color} 14%, white)`} as React.CSSProperties}><header>LINE {line}{canManage&&<button className="line-edit" aria-label={`Chỉnh sửa Line ${line}`} title={`Chỉnh sửa Line ${line}`} onClick={()=>onEdit(config)}>⚙</button>}</header><div className="layout-body">{config.logo?<em>{config.logo}</em>:<b>{config.name}</b>}</div><div className="layout-sides"><button aria-label={`Mở Line ${line}, mặt A`} onClick={()=>onOpen(line,"A")}>A</button><button aria-label={`Mở Line ${line}, mặt B`} onClick={()=>onOpen(line,"B")}>B</button></div></section>};
  return <div><PageHead eyebrow="BẢN ĐỒ CỬA HÀNG" title="Sơ đồ POG" subtitle="Chọn dãy và mặt kệ để xem vị trí sản phẩm chi tiết."/>
    <div className="full-map store-layout" aria-label="Sơ đồ layout cửa hàng"><div className="dd-zone dd-left">D&amp;D</div>{topLines.slice(0,5).map((line)=><LineCard key={line} line={line}/>)}<div className="promo-spine">PROMOTION</div>{topLines.slice(5).map((line)=><LineCard key={line} line={line}/>)}<div className="dd-zone dd-right">D&amp;D</div>{bottomLines.slice(0,8).map((line)=><LineCard key={line} line={line}/>)}{bottomLines.slice(8).map((line)=><LineCard key={line} line={line}/>)}</div><div className="you-are">● BẠN Ở ĐÂY · Chọn Mặt A hoặc B để xem sơ đồ kệ{canManage?" · Chọn ⚙ để chỉnh tên, màu và logo Line":""}</div></div>;
}
function ProductsView({products,total,role,importResult,importJob,onAdd,onEdit,onDelete,onMap,onPick,onExport,onImport}:{products:Product[];total:number;role:Role;importResult:MasterImportResult|null;importJob:MasterImportJob|null;onAdd:()=>void;onEdit:(p:Product)=>void;onDelete:(p:Product)=>void;onMap:(p:Product)=>void;onPick:(p:Product)=>void;onExport:()=>void;onImport:()=>void}) {
  const importing=Boolean(importJob&&["uploading","queued","processing"].includes(importJob.status));
  return <div><PageHead eyebrow="MASTER DATA" title="Master Data sản phẩm" subtitle={money.format(total)+" SKU phù hợp"} actions={<><button className="ghost" onClick={onExport}>↓ Xuất Master CSV</button>{canManage(role)&&<button className="ghost" disabled={importing} onClick={onImport}>{importing?"Đang nhập Excel…":"↑ Nhập Excel (.xlsx)"}</button>}{canManage(role)&&<button className="primary" onClick={onAdd}>+ Thêm sản phẩm</button>}</>}/>
    <div className="master-help"><b>Định dạng nhập Excel</b><span>Giữ đúng 9 cột bên dưới · đọc sheet đầu tiên · tối đa 500.000 dòng / 100 MB · cập nhật theo SKU. Nên đặt SKU và barcode ở định dạng Text để giữ số 0 đầu.</span></div>
    {importJob&&<section className={"master-import-progress "+importJob.status} aria-live="polite"><div><span>{importJob.status==="completed"?"✓":importJob.status==="failed"?"!":"↑"}</span><div><b>{importJob.phase}</b><small>{importJob.fileName}{importJob.totalRows>0?" · "+money.format(importJob.processedRows)+"/"+money.format(importJob.totalRows)+" dòng":" · bạn có thể tiếp tục sử dụng ứng dụng"}</small></div><strong>{Math.round(importJob.percent)}%</strong></div><i role="progressbar" aria-label="Tiến độ nhập Master Data" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(importJob.percent)}><span style={{width:Math.max(2,importJob.percent)+"%"}}/></i>{importJob.error&&<p>{importJob.error}</p>}</section>}
    {importResult&&<section className="master-import-summary"><div><b>Đã nhập {importResult.fileName}</b><span>{importResult.created} SKU mới · {importResult.updated} cập nhật · {importResult.unchanged} không thay đổi</span></div><strong>{importResult.totalProducts} SKU</strong>{importResult.skipped>0&&<small>{importResult.skipped} dòng được bỏ qua{importResult.duplicates>0?" · "+importResult.duplicates+" dòng SKU trùng":""}{importResult.issues[0]?" · Dòng "+importResult.issues[0].row+": "+importResult.issues[0].reason:""}</small>}</section>}
    <div className="table-wrap"><table className="master-table"><thead><tr><th>SKU</th><th>TÊN SẢN PHẨM</th><th>Division</th><th>DIVISION NAME</th><th>Department</th><th>DEPARTMENT</th><th>SUPPLIER BARCODE</th><th>Line</th><th>LINE NAME</th><th/></tr></thead><tbody>{products.map((p)=><tr key={p.id}>
      <td data-label="SKU"><b>{p.sku}</b></td>
      <td data-label="TÊN SẢN PHẨM"><strong>{p.name}</strong></td>
      <td data-label="Division">{p.division||"—"}</td>
      <td data-label="DIVISION NAME">{p.divisionName||"—"}</td>
      <td data-label="Department">{p.department||"—"}</td>
      <td data-label="DEPARTMENT">{p.departmentName||"—"}</td>
      <td data-label="SUPPLIER BARCODE"><b>{p.supplierBarcode||"—"}</b></td>
      <td data-label="Line"><b>{p.line}</b></td>
      <td data-label="LINE NAME">{p.lineName||"—"}</td>
      <td data-label=""><div className="row-actions"><button onClick={()=>onPick(p)}>+ Đơn</button><button onClick={()=>onMap(p)}>Vị trí</button>{canManage(role)&&<button onClick={()=>onEdit(p)}>Sửa</button>}{canManage(role)&&<button className="danger-text" onClick={()=>{if(window.confirm("Xóa sản phẩm “"+p.name+"”?"))onDelete(p)}}>Xóa</button>}</div></td>
    </tr>)}{!products.length&&<tr><td colSpan={10}><div className="empty big"><b>Chưa có sản phẩm phù hợp</b><span>Thử đổi bộ lọc hoặc nhập Master Data từ Excel.</span></div></td></tr>}</tbody></table></div></div>;
}
function StockCheckView({products,total,role,metadata,job,onImport,onExport,onAssign}:{products:Product[];total:number;role:Role;metadata?:StoreData["stockImport"];job:StockImportJob|null;onImport:()=>void;onExport:()=>void;onAssign:(product:Product)=>void}) {
  const active=Boolean(job&&["uploading","queued","processing"].includes(job.status));
  return <div><PageHead eyebrow="TỒN KHO TỪ FILE UPLOAD" title="Check Stock" subtitle="Chỉ hiển thị số tồn có trong file Stock đã upload; không lấy từ Master Data." actions={<>{products.length>0&&<button onClick={onExport}>↓ Xuất Stock</button>}{canManage(role)&&<button className="primary" disabled={active} onClick={onImport}>{active?"Đang xử lý…":"↑ Upload Stock .xlsx"}</button>}</>}/>
    <div className="master-help"><b>Định dạng file Stock</b><span>SKU · TÊN SẢN PHẨM · Department · Department Name · Division · Line · Line Name · Sales · Closing Stock. Khi nhập, hệ thống dùng SKU, Sales và Closing Stock; các cột còn lại được xuất từ Master Data.</span></div>
    {metadata&&<section className="master-import-summary"><div><b>File hiện tại: {metadata.fileName}</b><span>{money.format(metadata.recordCount)} SKU tồn kho · cập nhật {new Date(metadata.updatedAt).toLocaleString("vi-VN")}</span></div></section>}
    {job&&<section className={"master-import-progress "+job.status}><div><span>{job.status==="failed"?"!":"↑"}</span><div><b>{job.phase}</b><small>{job.fileName}</small></div><strong>{Math.round(job.percent)}%</strong></div><i><span style={{width:Math.max(2,job.percent)+"%"}}/></i>{job.error&&<p>{job.error}</p>}</section>}
    <div className="table-wrap"><table className="master-table"><thead><tr><th>SKU</th><th>TÊN SẢN PHẨM</th><th>Department</th><th>Division</th><th>Line</th><th>Sales</th><th>Closing Stock</th>{canManage(role)&&<th/>}</tr></thead><tbody>{products.map((p)=><tr key={p.id}><td><b>{p.sku}</b></td><td><strong>{p.name}</strong></td><td>{p.departmentName||p.department||"—"}</td><td>{p.division||"—"}</td><td>{p.lineName?"Line "+p.line+" · "+p.lineName:"Chưa khớp Master Data"}</td><td>{money.format(p.sales||0)}</td><td><StockBadge stock={p.stock}/></td>{canManage(role)&&<td><button className="primary assign-button" disabled={p.stock<=0} onClick={()=>onAssign(p)}>Gán đơn</button></td>}</tr>)}{!products.length&&<tr><td colSpan={canManage(role)?8:7}><div className="empty big"><b>Chưa có file Stock</b><span>Upload file Stock để bắt đầu xem tồn kho tách biệt.</span></div></td></tr>}</tbody></table></div><p className="stock-total">{money.format(total)} SKU có trong file Stock</p></div>;
}
function AssignPickModal({product,users,onClose,onAssign}:{product:Product;users:UserRole[];onClose:()=>void;onAssign:(assignment:{assigneeId:string;quantity:number;customerName:string;note:string})=>Promise<void>}) {
  const [assigneeId,setAssigneeId]=useState(users[0]?.userId||""),[quantity,setQuantity]=useState(1),[customerName,setCustomerName]=useState(""),[note,setNote]=useState("");
  return <div className="modal-backdrop"><section className="form-modal"><div className="modal-head"><div><p>GÁN SOẠN ĐƠN TỪ STOCK</p><h2>Giao sản phẩm cho nhân viên</h2></div><button onClick={onClose}>×</button></div><div className="form-grid"><p className="form-note wide"><b>{product.name}</b><br/>SKU {product.sku} · Tồn hiện có: {money.format(product.stock)}</p><label className="wide">Nhân viên soạn đơn<select value={assigneeId} onChange={(event)=>setAssigneeId(event.target.value)}>{users.map((user)=><option key={user.userId} value={user.userId}>{user.name} · {user.role}</option>)}</select></label><label>Tên khách hàng<input value={customerName} onChange={(event)=>setCustomerName(event.target.value)} placeholder="Ví dụ: Nguyễn Văn An"/></label><label>Số lượng<input type="number" min="1" max={product.stock} value={quantity} onChange={(event)=>setQuantity(Math.max(1,Number(event.target.value)||1))}/></label><label className="wide">Ghi chú Stock / đơn hàng<textarea rows={3} value={note} onChange={(event)=>setNote(event.target.value)} placeholder="Ví dụ: Ưu tiên hàng hạn dùng xa, giao buổi chiều…"/></label></div><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" disabled={!assigneeId||!customerName.trim()||quantity>product.stock} onClick={()=>void onAssign({assigneeId,quantity,customerName:customerName.trim(),note:note.trim()})}>Gán cho nhân viên</button></div></section></div>;
}
function ManualCheckGrid({kind,products,onAdd}:{kind:"stock"|"loss"|"expiry";products:Product[];onAdd:()=>void}) {
  const config=kind==="stock"?{eyebrow:"KIỂM KÊ THỦ CÔNG",title:"Kiểm tồn",subtitle:"Chỉ hiện các SKU đã được nhân viên nhập kiểm đếm thủ công.",label:"Tồn kiểm đếm",value:(p:Product)=>String(p.stock)}:kind==="loss"?{eyebrow:"KIỂM SOÁT THẤT THOÁT",title:"Thất thoát",subtitle:"Chỉ hiện các SKU đã được ghi nhận thủ công.",label:"Loss",value:(p:Product)=>String(p.loss)}:{eyebrow:"KIỂM TRA HẠN DÙNG",title:"Hạn dùng",subtitle:"Chỉ hiện các SKU đã được nhập hạn sử dụng thủ công.",label:"Hạn sử dụng",value:(p:Product)=>p.expDate};
  return <div><PageHead eyebrow={config.eyebrow} title={config.title} subtitle={config.subtitle} actions={<button className="primary" onClick={onAdd}>+ Nhập thủ công</button>}/><div className="check-grid">{products.map((p)=><article key={p.id}><div className="card-top"><span className={"line-token line-"+p.line}>{p.line}{p.side}</span>{kind==="expiry"&&<span className={"badge "+expiryStatus(p.expDate).tone}>{expiryStatus(p.expDate).label}</span>}</div><h2>{p.name}</h2><p>SKU {p.sku}</p><strong className="manual-value">{config.label}: {config.value(p)}</strong></article>)}{!products.length&&<div className="empty big grid-empty"><b>Chưa có dữ liệu nhập thủ công</b><span>Chọn “Nhập thủ công” và nhập SKU để tạo bản ghi đầu tiên.</span></div>}</div></div>;
}
function OrderView({items,assignedItems,role,onToggle,onAvailability,onQuantity,onRemove,onClear,onMap}:{items:PickItem[];assignedItems:AssignedPickItem[];role:Role;onToggle:(p:PickItem)=>void;onAvailability:(p:PickItem)=>void;onQuantity:(p:PickItem,quantity:number)=>void;onRemove:(p:PickItem)=>void;onClear:()=>void;onMap:(p:PickItem)=>void}) {
  const route=["16","15","14","13","12","11","10","09","08","07","06","05","04","03","02","01","17","18","19","20","21","22","23","24","25","26","27","28"];
  const sorted=[...items].sort((a,b)=>Number(Boolean(a.picked))-Number(Boolean(b.picked))||(route.indexOf(a.line)-route.indexOf(b.line))||a.side.localeCompare(b.side)||a.bay-b.bay);
  const pickedUnits=items.filter((p)=>Boolean(p.picked)).reduce((sum,p)=>sum+p.quantity,0),totalUnits=items.reduce((sum,p)=>sum+p.quantity,0),percent=totalUnits?Math.round(pickedUnits/totalUnits*100):0,next=sorted.find((p)=>!p.picked);
  const finish=()=>{if(next&&!window.confirm("Đơn vẫn còn sản phẩm chưa lấy. Bạn có chắc muốn hoàn tất và xóa đơn?"))return;onClear()};
  return <div><PageHead eyebrow="PICKING LIST" title="Đơn đang soạn" subtitle={pickedUnits+"/"+totalUnits+" sản phẩm đã lấy · sắp theo lộ trình Line"} actions={items.length?<button className="primary" onClick={finish}>{next?"Kết thúc sớm":"Hoàn tất đơn"}</button>:undefined}/>{next&&<section className="next-pick"><div><small>ĐIỂM LẤY TIẾP THEO</small><b>Line {next.line}{next.side} · Kệ {next.bay}</b><span>{next.name} · SL {next.quantity}</span></div><button onClick={()=>onMap(next)}>Mở vị trí →</button></section>}<div className="order-progress-large"><i><span style={{width:percent+"%"}}/></i><b>{percent}%</b></div>
    <div className="order-list">{sorted.map((p)=><article key={p.pickId} className={p.picked?"picked":""}><div className="pick-product-thumb">{p.imageUrl?<img src={p.imageUrl} alt=""/>:<span>{p.name.slice(0,2).toUpperCase()}</span>}</div><button className={"availability-toggle "+(p.available!==false?"available":"unavailable")} aria-label={p.available!==false?"Đánh dấu hết hàng":"Đánh dấu còn hàng"} onClick={()=>onAvailability(p)}><i/><span>{p.available!==false?"Còn hàng":"Hết hàng"}</span></button><button className="pick-check" aria-label={p.picked?"Đánh dấu chưa lấy":"Đánh dấu đã lấy"} onClick={()=>onToggle(p)}>{p.picked?"✓":""}</button><div><small>SKU {p.sku}{p.customerName?" · Khách: "+p.customerName:""}</small><b>{p.name}</b><span>{p.barcode||p.supplierBarcode?"Barcode: "+(p.barcode||p.supplierBarcode)+" · ":""}Line {p.line}{p.side} · Kệ {p.bay}{p.note?" · "+p.note:""}</span></div><div className="pick-quantity"><button disabled={p.quantity<=1} onClick={()=>onQuantity(p,p.quantity-1)}>−</button><b>{p.quantity}</b><button onClick={()=>onQuantity(p,p.quantity+1)}>+</button></div><StockBadge stock={p.stock}/><button onClick={()=>onMap(p)}>Vị trí</button><button className="danger-text" onClick={()=>onRemove(p)}>Bỏ</button></article>)}{!items.length&&<div className="empty big"><b>Đơn soạn đang trống</b><span>Chờ đơn được giao từ Check Stock hoặc thêm sản phẩm từ tìm kiếm.</span></div>}</div>{canManage(role)&&<AssignedOrdersView items={assignedItems}/>}</div>;
}
function AssignedOrdersView({items}:{items:AssignedPickItem[]}) {
  const grouped=new Map<string,AssignedPickItem[]>();for(const item of items){const key=(item.customerName||"Chưa đặt tên khách").trim().toLocaleLowerCase();grouped.set(key,[...(grouped.get(key)||[]),item]);}
  return <section className="assigned-orders"><div className="panel-title"><h2>ĐƠN ĐÃ GIAO THEO KHÁCH HÀNG</h2><span>{items.length} dòng đơn</span></div>{[...grouped.entries()].map(([,orders])=>{const totalQuantity=orders.reduce((sum,item)=>sum+item.quantity,0);const pickedQuantity=orders.filter((item)=>item.picked).reduce((sum,item)=>sum+item.quantity,0);return <article key={orders[0].customerName||"unnamed"}><header><b>Khách: {orders[0].customerName||"Chưa đặt tên"}</b><span>{totalQuantity} mặt hàng · {pickedQuantity}/{totalQuantity} đã lấy</span></header>{orders.map((item)=><div key={item.pickId}><em className={item.picked?"done":""}>{item.picked?"✓":"•"}</em><p><b>{item.name}</b><small>Nhân viên: {item.assigneeName||"—"} · SL {item.quantity} · SKU {item.sku}{item.note?" · Note: "+item.note:""}</small></p><strong>Line {item.line}{item.side}</strong></div>)}</article>})}{!items.length&&<div className="empty"><b>Chưa có đơn nào được giao.</b></div>}</section>;
}
function SuggestView({value,onValue,onGenerate,result,busy,error,totalProducts,onMap,onPick}:{value:string;onValue:(v:string)=>void;onGenerate:()=>void;result:AiSuggestionResult|null;busy:boolean;error:string;totalProducts:number;onMap:(item:AiSuggestion)=>void;onPick:(item:AiSuggestion)=>void}) {
  const examples=["Lẩu cho 4 người","BBQ cuối tuần","Bữa sáng nhanh","Tiệc sinh nhật"];
  return <div className="ai-page"><PageHead eyebrow="TRỢ LÝ AI" title="Gợi ý sản phẩm" subtitle="Phân tích trực tiếp danh sách hàng, tồn kho và vị trí kệ hiện có." actions={<span className="ai-catalog-status"><i/>{totalProducts} SKU sẵn sàng</span>}/>
    <section className="ai-query-card">
      <div className="ai-query-title"><span>AI</span><div><b>Bạn đang chuẩn bị gì?</b><small>Mô tả món ăn, sự kiện hoặc nhu cầu; kết quả chỉ lấy từ Master Data.</small></div></div>
      <div className="ai-query-box">
        <textarea rows={2} value={value} disabled={busy} onChange={(event)=>onValue(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();onGenerate();}}} placeholder="Ví dụ: Chuẩn bị lẩu cho 6 người, ưu tiên sản phẩm còn nhiều tồn…"/>
        <button disabled={busy||value.trim().length<2} onClick={onGenerate}>{busy?<><i className="mini-spinner"/>Đang phân tích…</>:<>✦ Phân tích</>}</button>
      </div>
      <div className="ai-examples"><span>Gợi ý nhanh</span>{examples.map((example)=><button key={example} disabled={busy} onClick={()=>onValue(example)}>{example}</button>)}</div>
    </section>

    <div className="ai-feedback" aria-live="polite" aria-busy={busy}>
      {busy&&<div className="ai-skeletons">{[0,1,2].map((item)=><article key={item}><i/><span/><span/><b/></article>)}</div>}
      {!busy&&error&&<section className="ai-error"><div><b>Chưa thể phân tích</b><span>{error}</span></div><button onClick={onGenerate}>Thử lại</button></section>}
      {!busy&&!error&&result&&<section className="ai-summary"><span className={"ai-source "+result.mode}>{result.mode==="ai"?"AI · OpenAI":"Phân tích nội bộ"}</span><div><b>{result.summary}</b>{result.notice&&<small>{result.notice}</small>}</div></section>}
      {!busy&&!error&&result&&result.items.length>0&&<div className="ai-results">{result.items.map((item,index)=><article key={item.productId}>
        <header><span>{String(index+1).padStart(2,"0")}</span><div><small>SKU {item.sku}</small><h2>{item.name}</h2></div><StockBadge stock={item.stock}/></header>
        <p>{item.reason}</p>
        <div className="ai-product-meta"><span>▦ Line {item.line}{item.side} · Kệ {item.bay}</span><span>{money.format(item.price)} đ</span><span>SL đề xuất: {item.quantity}</span></div>
        <footer><button className="ai-secondary" onClick={()=>onMap(item)}>Xem vị trí</button><button className="ai-primary" disabled={item.stock===0} onClick={()=>onPick(item)}>+ Thêm vào đơn</button></footer>
      </article>)}</div>}
      {!busy&&!error&&result&&!result.items.length&&<div className="ai-empty"><b>Chưa tìm thấy sản phẩm phù hợp đang còn tồn</b><span>Hãy thử mô tả rộng hơn hoặc chọn một gợi ý nhanh phía trên.</span></div>}
      {!busy&&!error&&!result&&<div className="ai-empty"><span className="ai-empty-mark">✦</span><b>AI chỉ đề xuất từ hàng hóa đang có</b><span>Không tạo tên sản phẩm, giá hoặc vị trí ngoài danh sách cửa hàng.</span></div>}
    </div>
  </div>;
}
function ProductModal({value,onChange,onClose,onSave}:{value:Product;onChange:(p:Product)=>void;onClose:()=>void;onSave:()=>void}) {
  const set=(key:keyof Product,next:string|number)=>onChange({...value,[key]:next});
  const setSupplierBarcode=(next:string)=>onChange({...value,supplierBarcode:next,barcode:next});
  return <div className="modal-backdrop"><section className="form-modal"><div className="modal-head"><div><p>MASTER DATA</p><h2>{value.id?"Chỉnh sửa sản phẩm":"Thêm sản phẩm"}</h2></div><button onClick={onClose}>×</button></div><div className="form-grid">
    <h3 className="form-section-title">Thông tin Master Data</h3>
    <label>SKU<input value={value.sku} onChange={(e)=>set("sku",e.target.value)}/></label><label>SUPPLIER BARCODE<input value={value.supplierBarcode||""} onChange={(e)=>setSupplierBarcode(e.target.value)}/></label>
    <label className="wide">TÊN SẢN PHẨM<input value={value.name} onChange={(e)=>set("name",e.target.value)}/></label>
    <label>Division<input value={value.division||""} onChange={(e)=>set("division",e.target.value)}/></label><label>DIVISION NAME<input value={value.divisionName||""} onChange={(e)=>set("divisionName",e.target.value)}/></label>
    <label>Department<input value={value.department||""} onChange={(e)=>set("department",e.target.value)}/></label><label>DEPARTMENT<input value={value.departmentName||""} onChange={(e)=>set("departmentName",e.target.value)}/></label>
    <label>Line<input value={value.line} inputMode="numeric" maxLength={2} onChange={(e)=>set("line",e.target.value)}/></label><label>LINE NAME<input value={value.lineName||""} onChange={(e)=>set("lineName",e.target.value)}/></label>
    <h3 className="form-section-title">Vị trí kệ</h3>
    <label>Mặt<select value={value.side} onChange={(e)=>set("side",e.target.value)}><option>A</option><option>B</option></select></label><label>Kệ<input type="number" min="1" value={value.bay} onChange={(e)=>set("bay",Number(e.target.value))}/></label>
    <label>Giá<input type="number" min="0" value={value.price} onChange={(e)=>set("price",Number(e.target.value))}/></label><p className="form-note wide">Tồn kho lấy từ tab Check Stock. Kiểm tồn, thất thoát và hạn dùng được nhập thủ công ở các tab riêng.</p>
  </div><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" onClick={onSave}>Lưu sản phẩm</button></div></section></div>;
}
function LineConfigModal({value,onChange,onClose,onSave}:{value:LineConfig;onChange:(config:LineConfig)=>void;onClose:()=>void;onSave:()=>void}) {
  return <div className="modal-backdrop"><section className="form-modal line-config-modal"><div className="modal-head"><div><p>THIẾT LẬP SƠ ĐỒ</p><h2>Line {value.line}</h2></div><button onClick={onClose}>×</button></div><div className="line-config-preview" style={{"--line":value.color} as React.CSSProperties}><b>{value.logo||value.name}</b><span>LINE {value.line}</span></div><div className="form-grid"><label className="wide">Tên hiển thị<input value={value.name} maxLength={48} onChange={(e)=>onChange({...value,name:e.target.value})} placeholder="Ví dụ: Tea Drinks"/></label><label>Màu Line<input type="color" value={value.color} onChange={(e)=>onChange({...value,color:e.target.value.toUpperCase()})}/></label><label>Mã màu<input value={value.color} maxLength={7} onChange={(e)=>onChange({...value,color:e.target.value.toUpperCase()})} placeholder="#DFB100"/></label><label className="wide">Logo / biểu tượng<input value={value.logo} maxLength={36} onChange={(e)=>onChange({...value,logo:e.target.value})} placeholder="Ví dụ: TOPVALU, ★, 🥛 (để trống để hiện tên Line)"/></label></div><p className="form-note">Logo hỗ trợ chữ ngắn hoặc emoji. Để trống logo nếu muốn hiển thị tên Line ở giữa kệ.</p><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" onClick={onSave}>Lưu Line</button></div></section></div>;
}
function SettingsModal({actor,users,theme,onTheme,onCreate,onUpdate,onPassword,onLogout,onClose}:{actor:Actor;users:UserRole[];theme:string;onTheme:(v:string)=>void;onCreate:(account:{name:string;username:string;password:string;role:Role})=>Promise<boolean>;onUpdate:(account:{userId:string;name?:string;role?:Role;active?:boolean;password?:string})=>Promise<boolean>;onPassword:(currentPassword:string,newPassword:string)=>Promise<boolean>;onLogout:()=>Promise<void>;onClose:()=>void}) {
  const themes=[["aeon","AEON"],["aeon-soft","AEON sáng"],["graphite","Tương phản"]] as const;
  const [draft,setDraft]=useState<{name:string;username:string;password:string;role:Role}>({name:"",username:"",password:"",role:"STAFF"});
  const [currentPassword,setCurrentPassword]=useState("");const [newPassword,setNewPassword]=useState("");
  const create=async()=>{if(await onCreate({...draft,username:draft.username.trim().toLowerCase()}))setDraft({name:"",username:"",password:"",role:"STAFF"});};
  const changePassword=async()=>{if(await onPassword(currentPassword,newPassword)){setCurrentPassword("");setNewPassword("");}};
  const resetPassword=(user:UserRole)=>{const password=window.prompt("Nhập mật khẩu mới cho "+user.name+" (tối thiểu 8 ký tự):");if(password!==null)void onUpdate({userId:user.userId,password});};
  return <div className="modal-backdrop"><section className="settings-modal account-settings"><div className="modal-head"><div><p>TÀI KHOẢN</p><h2>Tài khoản & phân quyền</h2></div><button onClick={onClose}>×</button></div><h3>Giao diện</h3><div className="theme-row">{themes.map(([color,label])=><button key={color} className={theme===color?"active":""} data-color={color} onClick={()=>onTheme(color)}><i/>{label}</button>)}</div>
    <h3>Tài khoản của tôi</h3><div className="my-account"><span>{actor.name.slice(0,2).toUpperCase()}</span><div><b>{actor.name}</b><small>@{actor.username} · {actor.role}</small></div></div>
    <div className="password-form"><label>Mật khẩu hiện tại<input type="password" value={currentPassword} autoComplete="current-password" onChange={(event)=>setCurrentPassword(event.target.value)}/></label><label>Mật khẩu mới<input type="password" value={newPassword} autoComplete="new-password" onChange={(event)=>setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự"/></label><button disabled={!currentPassword||newPassword.length<8} onClick={()=>void changePassword()}>Đổi mật khẩu</button></div>
    {actor.role==="ADMIN"&&<><h3>Tạo tài khoản mới</h3><div className="role-guide"><span><b>Staff</b>Nghiệp vụ soạn hàng</span><span><b>Manager</b>Thêm, sửa, xóa, nhập Excel</span><span><b>Admin</b>Toàn quyền và phân quyền</span></div><div className="account-create"><label>Tên hiển thị<input value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label><label>Tên đăng nhập<input value={draft.username} autoCapitalize="none" onChange={(event)=>setDraft({...draft,username:event.target.value})}/></label><label>Mật khẩu tạm<input type="password" value={draft.password} onChange={(event)=>setDraft({...draft,password:event.target.value})}/></label><label>Phân quyền<select value={draft.role} onChange={(event)=>setDraft({...draft,role:event.target.value as Role})}><option value="STAFF">Staff</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></label><button disabled={draft.name.trim().length<2||draft.username.trim().length<3||draft.password.length<8} onClick={()=>void create()}>+ Tạo tài khoản</button></div>
    <h3>Danh sách tài khoản</h3><div className="user-list account-list">{users.map((user)=><article key={user.userId} className={user.active?"":"inactive"}><span>{user.name.slice(0,2).toUpperCase()}</span><div className="account-identity"><b>{user.name}</b><small>@{user.username} · {user.active?"Đang hoạt động":"Đã khóa"}</small></div><div className="account-controls">{user.userId===actor.userId?<em>{user.role}</em>:<><select value={user.role} onChange={(event)=>void onUpdate({userId:user.userId,role:event.target.value as Role})}><option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="STAFF">Staff</option></select><button onClick={()=>void onUpdate({userId:user.userId,active:!user.active})}>{user.active?"Khóa":"Mở"}</button><button onClick={()=>resetPassword(user)}>Mật khẩu</button></>}</div></article>)}</div></>}
    <div className="modal-actions"><button className="ghost danger-text" onClick={()=>void onLogout()}>Đăng xuất</button><button className="primary" onClick={onClose}>Đóng</button></div></section></div>;
}
function PogModal({modal,setModal,products,total,file,search,setSearch,canUpload,uploadRef,onUpload,onPick,onClose}:{modal:{line:string;side:"A"|"B";selectedId?:string};setModal:(v:{line:string;side:"A"|"B";selectedId?:string})=>void;products:Product[];total:number;file?:PogFile;search:string;setSearch:(v:string)=>void;canUpload:boolean;uploadRef:React.RefObject<HTMLInputElement|null>;onUpload:(f?:File)=>void;onPick:(p:Product)=>void;onClose:()=>void}) {
  const selected=products.find((p)=>p.id===modal.selectedId);
  const switchSide=(side:"A"|"B")=>{setSearch("");setModal({line:modal.line,side})};
  return <div className="modal-backdrop pog-backdrop"><section className="pog-modal"><div className="pog-head"><div><p>SƠ ĐỒ KỆ CHI TIẾT</p><h2>Line {modal.line} · {aisleNames[modal.line]||"Khu vực"}</h2></div><div className="side-switch"><button className={modal.side==="A"?"active":""} onClick={()=>switchSide("A")}>Mặt A</button><button className={modal.side==="B"?"active":""} onClick={()=>switchSide("B")}>Mặt B</button></div>{canUpload&&<button className="upload-pog" onClick={()=>uploadRef.current?.click()}>↑ Tải ảnh/PDF</button>}<button className="close-pog" onClick={onClose}>×</button></div>
    <div className="pog-body"><div className="pog-visual">{file?(file.mimeType==="application/pdf"?<iframe src={"/api/pog?id="+file.id} title="POG PDF"/>:<img src={"/api/pog?id="+file.id} alt={"POG Line "+modal.line}/>):<ShelfPlan products={products} selectedId={modal.selectedId}/>} {file&&file.mimeType!=="application/pdf"&&selected&&<div className="image-marker" style={{left:`${Math.min(91,8+selected.bay*10)}%`}}><i/><span>Kệ {selected.bay}<b>{selected.name}</b></span></div>}<div className="pog-file-label">{file?file.fileName:"Sơ đồ kệ tự động từ Master Data"}</div></div>
    <aside className="pog-list"><label>⌕<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Tìm SKU, barcode, tên…"/><b>{products.length}/{total} SP</b></label>{total>products.length&&<p className="pog-limit-note">Đang hiện 200 kết quả đầu · nhập SKU hoặc tên để tìm chính xác.</p>}<div>{products.map((p)=><button key={p.id} className={p.id===modal.selectedId?"active":""} onClick={()=>setModal({...modal,selectedId:p.id})}><span>Kệ {p.bay}</span><div><small>SKU {p.sku}</small><b>{p.name}</b><em>{p.supplierBarcode||p.barcode}</em></div><StockBadge stock={p.stock}/></button>)}{!products.length&&<div className="empty big">Chưa có sản phẩm ở mặt kệ này.</div>}</div>{selected&&<section className="pog-selected"><div><b>Line {selected.line}{selected.side} · Kệ {selected.bay}</b><span>{selected.name}</span><small>Tồn {selected.stock} · Loss {selected.loss} · HSD {selected.expDate||"chưa có"}</small></div><button disabled={selected.stock===0} onClick={()=>onPick(selected)}>+ Thêm vào đơn</button></section>}</aside></div>
    <input ref={uploadRef} hidden type="file" accept="image/*,application/pdf" onChange={(e)=>onUpload(e.target.files?.[0])}/></section></div>;
}
function ShelfPlan({products,selectedId}:{products:Product[];selectedId?:string}) {
  return <div className="shelf-plan">{Array.from({length:8},(_,index)=>index+1).map((bay)=><div key={bay}><span>KỆ {bay}</span><section>{products.filter((p)=>p.bay===bay).map((p)=><article key={p.id} className={p.id===selectedId?"active":""}><small>{p.sku}</small><b>{p.name.slice(0,24)}</b></article>)}</section></div>)}</div>;
}
