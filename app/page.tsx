"use client";
/* eslint-disable @next/next/no-img-element -- POG uploads are served dynamically by the Node API. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type Tab = "DASHBOARD" | "MAP" | "PRODUCTS" | "STOCK" | "LOSS" | "DATE" | "ORDER" | "SUGGEST";
type Product = { id:string; sku:string; barcode:string; name:string; line:string; side:"A"|"B"; bay:number; price:number; stock:number; loss:number; expDate:string; updatedAt?:number };
type PickItem = Product & { quantity:number; picked:boolean|number };
type Actor = { userId:string; email:string; name:string; role:Role };
type Audit = { id:string; action:string; userId:string; userName:string; createdAt:number };
type UserRole = { userId:string; email:string; name:string; role:Role; createdAt:number };
type PogFile = { id:string; line:string; side:"A"|"B"; fileName:string; mimeType:string; updatedAt:number };
type LineConfig = { line:string; name:string; color:string; logo:string; updatedAt?:number };
type StoreData = { actor:Actor; products:Product[]; logs:Audit[]; picking:PickItem[]; users:UserRole[]; pogFiles:PogFile[]; lineConfigs?:LineConfig[] };

const aisleNames: Record<string,string> = {
  "01":"Souvenir","02":"Chocolate","03":"Fruit","04":"Confectionery","05":"Milk","06":"Milk","07":"Kids","08":"Kids",
  "09":"Nonfood","10":"Home Coordy","11":"Home Coordy","12":"Household","13":"Household","14":"Nonfood","15":"Nonfood",
  "16":"Nonfood","17":"Beer & Liquor","18":"Tea & Drinks","19":"Coffee","20":"Topvalu","21":"Topvalu","22":"Asia",
  "23":"Asia","24":"Noodles","25":"Rice","26":"Sauces","27":"Spices","28":"Seafood"
};
const menu: Array<{id:Tab;label:string;icon:string}> = [
  {id:"DASHBOARD",label:"Tổng quan",icon:"◫"},{id:"MAP",label:"Sơ đồ POG",icon:"▦"},{id:"PRODUCTS",label:"Sản phẩm",icon:"▤"},
  {id:"STOCK",label:"Check Stock",icon:"□"},{id:"LOSS",label:"Check Loss",icon:"△"},{id:"DATE",label:"Check Date",icon:"◷"},
  {id:"ORDER",label:"Đơn soạn",icon:"✓"},{id:"SUGGEST",label:"Gợi ý AI",icon:"✦"}
];
const emptyProduct: Product = { id:"",sku:"",barcode:"",name:"",line:"01",side:"A",bay:1,price:0,stock:0,loss:0,expDate:"" };
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

function StockBadge({stock}:{stock:number}) {
  return <span className={"badge " + (stock === 0 ? "danger" : stock < 10 ? "warning" : "success")}>{stock === 0 ? "Hết hàng" : stock < 10 ? "Sắp hết · " + stock : "Còn hàng · " + stock}</span>;
}

export default function Home() {
  const [data,setData] = useState<StoreData|null>(null);
  const [tab,setTab] = useState<Tab>("DASHBOARD");
  const [query,setQuery] = useState("");
  const [stockFilter,setStockFilter] = useState<"all"|"available"|"low"|"out">("all");
  const [lineFilter,setLineFilter] = useState("all");
  const [lastSyncedAt,setLastSyncedAt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [productModal,setProductModal] = useState<Product|null>(null);
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [lineModal,setLineModal] = useState<LineConfig|null>(null);
  const [pogModal,setPogModal] = useState<{line:string;side:"A"|"B";selectedId?:string}|null>(null);
  const [pogSearch,setPogSearch] = useState("");
  const [suggestInput,setSuggestInput] = useState("");
  const [suggestions,setSuggestions] = useState<Array<{name:string;line:string;reason:string}>>([]);
  const [theme,setTheme] = useState(()=>typeof window==="undefined"?"forest":window.localStorage.getItem("fulfillment-theme")||"forest");
  const csvRef = useRef<HTMLInputElement>(null);
  const pogRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async (quiet=false) => {
    if (!quiet) setBusy(true);
    try {
      const response = await fetch("/api/store", { cache:"no-store" });
      const payload = await response.json() as StoreData & {error?:string};
      if (!response.ok) throw new Error(payload.error || "Không thể tải dữ liệu");
      setData(payload); setError(""); setLastSyncedAt(Date.now());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu"); }
    finally { if (!quiet) setBusy(false); }
  },[]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadData(),0);
    const timer = window.setInterval(() => void loadData(true),15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  },[loadData]);
  useEffect(() => { document.documentElement.dataset.theme=theme; window.localStorage.setItem("fulfillment-theme",theme); },[theme]);
  useEffect(() => { if (!toast) return; const timer=window.setTimeout(()=>setToast(""),2600); return ()=>window.clearTimeout(timer); },[toast]);

  const mutate = async (action:string, payload:Record<string,unknown>={}) => {
    setBusy(true);
    try {
      const response = await fetch("/api/store",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...payload})});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || "Thao tác thất bại");
      await loadData(true); setToast("Đã cập nhật thành công");
      return true;
    } catch (cause) { setToast(cause instanceof Error ? cause.message : "Thao tác thất bại"); return false; }
    finally { setBusy(false); }
  };

  const products = useMemo(()=>data?.products||[],[data?.products]);
  const filtered = useMemo(() => {
    const needle=normalize(query);
    return products.filter((p) => {
      const hit=!needle || normalize([p.name,p.sku,p.barcode,p.line,p.side].join(" ")).includes(needle);
      const stockHit=stockFilter==="all" || (stockFilter==="available" ? p.stock>0 : stockFilter==="low" ? p.stock>0&&p.stock<10 : p.stock===0);
      const lineHit=lineFilter==="all" || p.line===lineFilter;
      return hit && stockHit && lineHit;
    });
  },[products,query,stockFilter,lineFilter]);
  const searchMatches = query.length >= 2 ? filtered.slice(0,8) : [];
  const totalLoss = products.reduce((sum,p)=>sum+p.loss,0);
  const outCount = products.filter((p)=>p.stock===0).length;
  const lowCount = products.filter((p)=>p.stock>0&&p.stock<10).length;
  const expiring = products.filter((p)=>expiryStatus(p.expDate).tone==="warning"||expiryStatus(p.expDate).tone==="danger").length;
  const pickedCount = (data?.picking||[]).filter((p)=>Boolean(p.picked)).length;
  const progress = data?.picking?.length ? Math.round(pickedCount/data.picking.length*100) : 0;
  const pogProducts = pogModal ? products.filter((p)=>p.line===pogModal.line && p.side===pogModal.side && normalize(p.name+" "+p.sku+" "+p.barcode).includes(normalize(pogSearch))) : [];
  const activePog = pogModal ? data?.pogFiles.find((file)=>file.id===pogModal.line+"_"+pogModal.side) : undefined;
  const availableLines = useMemo(()=>Array.from(new Set(products.map((p)=>p.line))).sort((a,b)=>Number(a)-Number(b)),[products]);

  const exportCsv = () => {
    const headers=["SKU","Barcode","Name","Line","Side","Bay","Price","Stock","Loss","ExpDate"];
    const rows=products.map((p)=>[p.sku,p.barcode,p.name,p.line,p.side,p.bay,p.price,p.stock,p.loss,p.expDate]);
    const csv="\uFEFF"+[headers,...rows].map((row)=>row.map((cell)=>'"'+String(cell).replace(/"/g,'""')+'"').join(",")).join("\n");
    const link=document.createElement("a"); link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); link.download="MasterData_Fulfillment.csv"; link.click(); URL.revokeObjectURL(link.href);
  };
  const parseCsv = (text:string) => {
    const rows:Array<string[]> = []; let row:string[]=[]; let field=""; let quoted=false;
    for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(char===","&&!quoted){row.push(field);field="";}else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&text[i+1]==="\n")i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field="";}else field+=char;}
    row.push(field);if(row.some(Boolean))rows.push(row);
    const heads=(rows.shift()||[]).map((h)=>normalize(h).replace(/\s/g,""));
    return rows.map((values)=>{const get=(...names:string[])=>{const index=heads.findIndex((h)=>names.includes(h));return index>=0?values[index]||"":"";};return {sku:get("sku","mahang"),barcode:get("barcode","ean"),name:get("name","tensanpham","ten"),line:get("line","day"),side:get("side","mat"),bay:get("bay","ke"),price:get("price","gia"),stock:get("stock","ton"),loss:get("loss","haohut"),expDate:get("expdate","hsd")};});
  };
  const importCsv = async (file?:File) => {
    if(!file)return; const rows=parseCsv(await file.text()); await mutate("importProducts",{products:rows}); if(csvRef.current)csvRef.current.value="";
  };

  const openProductOnMap = (product:Product) => { setPogModal({line:product.line,side:product.side,selectedId:product.id});setPogSearch(product.sku);setQuery(""); };
  const quickAdd = async (product:Product) => { if(product.stock===0){setToast("Sản phẩm đang hết hàng");return;}if(await mutate("addPick",{productId:product.id,quantity:1}))setQuery(""); };
  const handleSearchEnter = () => { const needle=normalize(query);const exact=products.find((p)=>normalize(p.sku)===needle||normalize(p.barcode)===needle);if(exact)void quickAdd(exact);else if(searchMatches[0])openProductOnMap(searchMatches[0]); };
  const uploadPog = async (file?:File) => {
    if(!file||!pogModal)return; setBusy(true);
    try { const form=new FormData();form.set("file",file);form.set("line",pogModal.line);form.set("side",pogModal.side);
      const response=await fetch("/api/pog",{method:"POST",body:form});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||"Không thể tải POG");
      await loadData(true);setToast("Đã cập nhật POG "+pogModal.line+pogModal.side);
    } catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tải POG");} finally{setBusy(false);if(pogRef.current)pogRef.current.value="";}
  };
  const generateSuggestions = () => {
    const value=normalize(suggestInput);let list:Array<{name:string;line:string;reason:string}>=[];
    if(/lau|hotpot/.test(value))list=[{name:"Rau và nấm",line:"03",reason:"Ăn kèm lẩu"},{name:"Thịt và hải sản",line:"28",reason:"Món nhúng"},{name:"Mì / bún",line:"24",reason:"Tinh bột"},{name:"Sốt lẩu",line:"26",reason:"Nước dùng"}];
    else if(/nuong|bbq/.test(value))list=[{name:"Sốt BBQ",line:"26",reason:"Tẩm ướp"},{name:"Nước giải khát",line:"18",reason:"Dùng kèm"},{name:"Đồ gia dụng",line:"13",reason:"Dụng cụ nướng"}];
    else {list=filtered.slice(0,5).map((p)=>({name:p.name,line:p.line,reason:p.stock?"Có sẵn trong kho":"Cần thay thế vì hết hàng"}));}
    setSuggestions(list);
  };

  if (!data && busy) return <main className="loading-screen"><div className="spinner"/><b>Đang đồng bộ dữ liệu cửa hàng…</b></main>;
  if (!data && error) return <main className="loading-screen"><b>Không thể mở dữ liệu</b><p>{error}</p><button onClick={()=>void loadData()}>Thử lại</button></main>;
  if (!data) return null;

  return (
    <main className="ops-shell">
      {toast&&<div className="toast">{toast}</div>}
      {busy&&<div className="busy-line"/>}
      <header className="ops-topbar">
        <button className="ops-brand" onClick={()=>setTab("DASHBOARD")}><b>F</b><span>FULFILLMENT<br/>SMARTOPS</span></button>
        <div className="global-search">
          <span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")handleSearchEnter()}} placeholder="Tìm hoặc quét SKU, barcode…" />
          {query&&<button onClick={()=>setQuery("")}>×</button>}
          {query.length>=2&&<div className="search-popover">{searchMatches.map((p)=><article key={p.id}><button className="search-result-main" onClick={()=>openProductOnMap(p)}><span><b>{p.name}</b><small>SKU {p.sku} · Line {p.line}{p.side} · Kệ {p.bay}</small></span><StockBadge stock={p.stock}/></button><button className="search-quick-add" disabled={p.stock===0} onClick={()=>void quickAdd(p)}>+ Đơn</button></article>)}{!searchMatches.length&&<div className="search-empty"><b>Không tìm thấy sản phẩm</b><span>Kiểm tra lại SKU, barcode hoặc tên hàng.</span></div>}</div>}
        </div>
        <button className="top-order" onClick={()=>setTab("ORDER")}><span>ĐƠN SOẠN</span><b>{pickedCount}/{data.picking.length}</b><i><em style={{width:progress+"%"}}/></i></button>
        <div className={"sync-chip "+(error?"offline":"online")} title={error||"Dữ liệu được tự động cập nhật mỗi 15 giây"}><i/>{error?"Mất kết nối":lastSyncedAt?"Đã đồng bộ":"Đang nối"}</div>
        <button className="user-chip" onClick={()=>setSettingsOpen(true)}><span>{data.actor.name.slice(0,2).toUpperCase()}</span><b>{data.actor.name}<small>{data.actor.role}</small></b></button>
      </header>

      <div className="ops-body">
        <nav className="side-nav">{menu.map((item)=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}><span>{item.icon}</span>{item.label}{item.id==="ORDER"&&data.picking.length>0?<b>{data.picking.length}</b>:null}</button>)}</nav>
        <section className="ops-content">
          {(["PRODUCTS","STOCK","LOSS","DATE"] as Tab[]).includes(tab)&&<OpsFilters lines={availableLines} line={lineFilter} stock={stockFilter} visible={filtered.length} total={products.length} onLine={setLineFilter} onStock={setStockFilter} onClear={()=>{setQuery("");setLineFilter("all");setStockFilter("all")}}/>}
          {tab==="DASHBOARD"&&<Dashboard products={products} logs={data.logs} totals={{outCount,lowCount,totalLoss,expiring}} onGo={setTab}/>}
          {tab==="MAP"&&<MapView products={products} lineConfigs={data.lineConfigs||[]} query={query} canManage={canManage(data.actor.role)} onOpen={(line,side)=>setPogModal({line,side})} onEdit={(lineConfig)=>setLineModal(lineConfig)}/>}
          {tab==="PRODUCTS"&&<ProductsView products={filtered} role={data.actor.role} onAdd={()=>setProductModal({...emptyProduct})} onEdit={(p)=>setProductModal({...p})} onDelete={(p)=>void mutate("deleteProduct",{id:p.id})} onMap={openProductOnMap} onPick={(p)=>void mutate("addPick",{productId:p.id})} onExport={exportCsv} onImport={()=>csvRef.current?.click()}/>}
          {tab==="STOCK"&&<CheckGrid kind="stock" products={filtered} onAdjust={(p,d)=>void mutate("adjustStock",{id:p.id,delta:d})}/>}
          {tab==="LOSS"&&<CheckGrid kind="loss" products={filtered} onAdjust={(p,d)=>void mutate("adjustLoss",{id:p.id,delta:d})}/>}
          {tab==="DATE"&&<DateGrid products={filtered} onChange={(p,value)=>void mutate("updateDate",{id:p.id,expDate:value})}/>}
          {tab==="ORDER"&&<OrderView items={data.picking} onToggle={(p)=>void mutate("togglePick",{productId:p.id})} onQuantity={(p,quantity)=>void mutate("updatePickQuantity",{productId:p.id,quantity})} onRemove={(p)=>void mutate("removePick",{productId:p.id})} onClear={()=>void mutate("clearPick")} onMap={openProductOnMap}/>}
          {tab==="SUGGEST"&&<SuggestView value={suggestInput} onValue={setSuggestInput} onGenerate={generateSuggestions} suggestions={suggestions} onLine={(line)=>setPogModal({line,side:"A"})}/>}
        </section>
      </div>

      <nav className="mobile-nav">{menu.slice(0,7).map((item)=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}><span>{item.icon}</span>{item.label.replace("Check ","")}</button>)}</nav>
      <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e)=>void importCsv(e.target.files?.[0])}/>

      {productModal&&<ProductModal value={productModal} onChange={setProductModal} onClose={()=>setProductModal(null)} onSave={async()=>{if(await mutate("upsertProduct",{product:productModal}))setProductModal(null);}}/>}
      {settingsOpen&&<SettingsModal actor={data.actor} users={data.users} theme={theme} onTheme={setTheme} onRole={(userId,role)=>void mutate("setRole",{userId,role})} onClose={()=>setSettingsOpen(false)}/>}
      {lineModal&&<LineConfigModal value={lineModal} onChange={setLineModal} onClose={()=>setLineModal(null)} onSave={async()=>{if(await mutate("updateLineConfig",{lineConfig:lineModal}))setLineModal(null);}}/>}
      {pogModal&&<PogModal modal={pogModal} setModal={setPogModal} products={pogProducts} file={activePog} search={pogSearch} setSearch={setPogSearch} canUpload={canManage(data.actor.role)} uploadRef={pogRef} onUpload={(file)=>void uploadPog(file)} onPick={(product)=>void quickAdd(product)} onClose={()=>setPogModal(null)}/>}
    </main>
  );
}

function PageHead({eyebrow,title,subtitle,actions}:{eyebrow:string;title:string;subtitle:string;actions?:React.ReactNode}) {
  return <div className="page-head"><div><p>{eyebrow}</p><h1>{title}</h1><span>{subtitle}</span></div>{actions&&<div className="head-actions">{actions}</div>}</div>;
}
function OpsFilters({lines,line,stock,visible,total,onLine,onStock,onClear}:{lines:string[];line:string;stock:"all"|"available"|"low"|"out";visible:number;total:number;onLine:(value:string)=>void;onStock:(value:"all"|"available"|"low"|"out")=>void;onClear:()=>void}) {
  return <div className="ops-filters"><label>Line<select value={line} onChange={(e)=>onLine(e.target.value)}><option value="all">Tất cả Line</option>{lines.map((item)=><option key={item} value={item}>Line {item}</option>)}</select></label><div className="filter-chips">{([['all','Tất cả'],['available','Còn hàng'],['low','Tồn thấp'],['out','Hết hàng']] as const).map(([value,label])=><button key={value} className={stock===value?"active":""} onClick={()=>onStock(value)}>{label}</button>)}</div><span>{visible}/{total} sản phẩm</span>{(line!=="all"||stock!=="all")&&<button className="clear-filters" onClick={onClear}>Xóa lọc</button>}</div>;
}
function Dashboard({products,logs,totals,onGo}:{products:Product[];logs:Audit[];totals:{outCount:number;lowCount:number;totalLoss:number;expiring:number};onGo:(tab:Tab)=>void}) {
  const cards=[["Tổng SKU",products.length,"PRODUCTS","▤"],["Cạn kho",totals.outCount,"STOCK","!"],["Tồn thấp",totals.lowCount,"STOCK","↓"],["Loss",totals.totalLoss,"LOSS","△"],["HSD cảnh báo",totals.expiring,"DATE","◷"]] as const;
  const alerts=products.filter((p)=>p.stock<10||p.loss>0||["warning","danger"].includes(expiryStatus(p.expDate).tone)).slice(0,6);
  return <div><PageHead eyebrow="TRUNG TÂM VẬN HÀNH" title="Tổng quan hôm nay" subtitle="Tồn kho, thất thoát và công việc soạn đơn được cập nhật đồng bộ."/>
    <div className="metric-grid">{cards.map((card)=><button key={card[0]} onClick={()=>onGo(card[2])}><i>{card[3]}</i><span>{card[0]}</span><strong>{card[1]}</strong></button>)}</div>
    <div className="dash-grid"><section className="panel"><div className="panel-title"><h2>Cảnh báo cần xử lý</h2><span>{alerts.length} mục</span></div><div className="alert-list">{alerts.map((p)=><article key={p.id}><div className={"line-token line-"+p.line}>{p.line}</div><div><b>{p.name}</b><span>SKU {p.sku} · Tồn {p.stock} · Loss {p.loss}</span></div><StockBadge stock={p.stock}/></article>)}</div></section>
    <section className="panel"><div className="panel-title"><h2>Lịch sử thao tác</h2><span>Real-time</span></div><div className="audit-list">{logs.slice(0,10).map((log)=><article key={log.id}><i/><div><b>{log.action}</b><span>{log.userName} · {new Date(log.createdAt).toLocaleString("vi-VN")}</span></div></article>)}{!logs.length&&<div className="empty">Chưa có thao tác</div>}</div></section></div></div>;
}
function MapView({products,lineConfigs,query,canManage,onOpen,onEdit}:{products:Product[];lineConfigs:LineConfig[];query:string;canManage:boolean;onOpen:(line:string,side:"A"|"B")=>void;onEdit:(lineConfig:LineConfig)=>void}) {
  const topLines=["17","18","19","20","21","22","23","24","25","26","27","28"];
  const bottomLines=["16","15","14","13","12","11","10","09","08","07","06","05","04","03","02","01"];
  const configByLine=new Map(lineConfigs.map((config)=>[config.line,config]));
  const matched=new Set(products.filter((p)=>!query||normalize([p.name,p.sku,p.barcode,p.line,p.side,configByLine.get(p.line)?.name||aisleNames[p.line]].join(" ")).includes(normalize(query))).map((p)=>p.line));
  const LineCard=({line}:{line:string})=>{const config=configByLine.get(line)||{line,name:aisleNames[line],color:"#62676A",logo:""};const hit=matched.has(line)&&Boolean(query);return <section className={`layout-line line-${line}${hit?" match":""}`} style={{"--line":config.color,"--body":`color-mix(in srgb, ${config.color} 14%, white)`} as React.CSSProperties}><header>LINE {line}{canManage&&<button className="line-edit" aria-label={`Chỉnh sửa Line ${line}`} title={`Chỉnh sửa Line ${line}`} onClick={()=>onEdit(config)}>⚙</button>}</header><div className="layout-body">{config.logo?<em>{config.logo}</em>:<b>{config.name}</b>}</div><div className="layout-sides"><button aria-label={`Mở Line ${line}, mặt A`} onClick={()=>onOpen(line,"A")}>A</button><button aria-label={`Mở Line ${line}, mặt B`} onClick={()=>onOpen(line,"B")}>B</button></div></section>};
  return <div><PageHead eyebrow="BẢN ĐỒ CỬA HÀNG" title="Sơ đồ POG" subtitle="Chọn dãy và mặt kệ để xem vị trí sản phẩm chi tiết."/>
    <div className="full-map store-layout" aria-label="Sơ đồ layout cửa hàng"><div className="dd-zone dd-left">D&amp;D</div>{topLines.slice(0,5).map((line)=><LineCard key={line} line={line}/>)}<div className="promo-spine">PROMOTION</div>{topLines.slice(5).map((line)=><LineCard key={line} line={line}/>)}<div className="dd-zone dd-right">D&amp;D</div>{bottomLines.slice(0,8).map((line)=><LineCard key={line} line={line}/>)}{bottomLines.slice(8).map((line)=><LineCard key={line} line={line}/>)}</div><div className="you-are">● BẠN Ở ĐÂY · Chọn Mặt A hoặc B để xem sơ đồ kệ{canManage?" · Chọn ⚙ để chỉnh tên, màu và logo Line":""}</div></div>;
}
function ProductsView({products,role,onAdd,onEdit,onDelete,onMap,onPick,onExport,onImport}:{products:Product[];role:Role;onAdd:()=>void;onEdit:(p:Product)=>void;onDelete:(p:Product)=>void;onMap:(p:Product)=>void;onPick:(p:Product)=>void;onExport:()=>void;onImport:()=>void}) {
  return <div><PageHead eyebrow="MASTER DATA" title="Cơ sở dữ liệu sản phẩm" subtitle={products.length+" sản phẩm đang hiển thị"} actions={<><button className="ghost" onClick={onExport}>↓ Xuất CSV</button>{canManage(role)&&<button className="ghost" onClick={onImport}>↑ Nhập CSV</button>}{canManage(role)&&<button className="primary" onClick={onAdd}>+ Thêm sản phẩm</button>}</>}/>
    <div className="table-wrap"><table><thead><tr><th>SKU / Barcode</th><th>Sản phẩm</th><th>Vị trí</th><th>Giá</th><th>Tồn / Loss</th><th/></tr></thead><tbody>{products.map((p)=><tr key={p.id}><td><b>{p.sku}</b><small>{p.barcode||"—"}</small></td><td><strong>{p.name}</strong><small>HSD {p.expDate?new Date(p.expDate+"T00:00:00").toLocaleDateString("vi-VN"):"—"}</small></td><td><button className="location-chip" onClick={()=>onMap(p)}>Line {p.line}{p.side} · Kệ {p.bay}</button></td><td><b>{money.format(p.price)} đ</b></td><td><StockBadge stock={p.stock}/><small>Loss {p.loss}</small></td><td><div className="row-actions"><button onClick={()=>onPick(p)}>+ Đơn</button>{canManage(role)&&<button onClick={()=>onEdit(p)}>Sửa</button>}{canManage(role)&&<button className="danger-text" onClick={()=>{if(window.confirm(`Xóa sản phẩm “${p.name}”?`))onDelete(p)}}>Xóa</button>}</div></td></tr>)}</tbody></table></div></div>;
}
function CheckGrid({kind,products,onAdjust}:{kind:"stock"|"loss";products:Product[];onAdjust:(p:Product,d:number)=>void}) {
  const isLoss=kind==="loss";return <div><PageHead eyebrow={isLoss?"KIỂM SOÁT THẤT THOÁT":"KIỂM KÊ TỒN KHO"} title={isLoss?"Check Loss":"Check Stock"} subtitle={isLoss?"Ghi nhận số lượng hủy, hỏng hoặc thất thoát.":"Điều chỉnh tồn khả dụng theo kết quả kiểm đếm."}/>
    <div className="check-grid">{products.map((p)=><article key={p.id} className={isLoss&&p.loss>0?"loss-card":""}><div className="card-top"><span className={"line-token line-"+p.line}>{p.line}{p.side}</span><small>SKU {p.sku}</small></div><h2>{p.name}</h2><p>{isLoss?"Số lượng loss":"Tồn khả dụng"}</p><div className="stepper"><button aria-label="Giảm 1" onClick={()=>onAdjust(p,-1)}>−</button><strong>{isLoss?p.loss:p.stock}</strong><button aria-label="Tăng 1" onClick={()=>onAdjust(p,1)}>+</button></div>{!isLoss&&<StockBadge stock={p.stock}/>}</article>)}{!products.length&&<div className="empty big grid-empty"><b>Không có sản phẩm phù hợp</b><span>Thử đổi Line hoặc bộ lọc tồn kho.</span></div>}</div></div>;
}
function DateGrid({products,onChange}:{products:Product[];onChange:(p:Product,value:string)=>void}) {
  const ordered=[...products].sort((a,b)=>(a.expDate?new Date(a.expDate).getTime():0)-(b.expDate?new Date(b.expDate).getTime():0));
  return <div><PageHead eyebrow="KIỂM TRA HẠN DÙNG" title="Check Date" subtitle="Ưu tiên sản phẩm chưa có HSD, đã hết hạn và sắp hết hạn."/><div className="check-grid">{ordered.map((p)=>{const status=expiryStatus(p.expDate);return <article key={p.id}><div className="card-top"><span className={"line-token line-"+p.line}>{p.line}{p.side}</span><span className={"badge "+status.tone}>{status.label}</span></div><h2>{p.name}</h2><p>SKU {p.sku}</p><label className="date-input">Hạn sử dụng<input type="date" value={p.expDate||""} onChange={(e)=>onChange(p,e.target.value)}/></label></article>})}{!ordered.length&&<div className="empty big grid-empty"><b>Không có sản phẩm phù hợp</b><span>Thử đổi Line hoặc bộ lọc tồn kho.</span></div>}</div></div>;
}
function OrderView({items,onToggle,onQuantity,onRemove,onClear,onMap}:{items:PickItem[];onToggle:(p:PickItem)=>void;onQuantity:(p:PickItem,quantity:number)=>void;onRemove:(p:PickItem)=>void;onClear:()=>void;onMap:(p:PickItem)=>void}) {
  const route=["16","15","14","13","12","11","10","09","08","07","06","05","04","03","02","01","17","18","19","20","21","22","23","24","25","26","27","28"];
  const sorted=[...items].sort((a,b)=>Number(Boolean(a.picked))-Number(Boolean(b.picked))||(route.indexOf(a.line)-route.indexOf(b.line))||a.side.localeCompare(b.side)||a.bay-b.bay);
  const pickedUnits=items.filter((p)=>Boolean(p.picked)).reduce((sum,p)=>sum+p.quantity,0),totalUnits=items.reduce((sum,p)=>sum+p.quantity,0),percent=totalUnits?Math.round(pickedUnits/totalUnits*100):0,next=sorted.find((p)=>!p.picked);
  const finish=()=>{if(next&&!window.confirm("Đơn vẫn còn sản phẩm chưa lấy. Bạn có chắc muốn hoàn tất và xóa đơn?"))return;onClear()};
  return <div><PageHead eyebrow="PICKING LIST" title="Đơn đang soạn" subtitle={pickedUnits+"/"+totalUnits+" sản phẩm đã lấy · sắp theo lộ trình Line"} actions={items.length?<button className="primary" onClick={finish}>{next?"Kết thúc sớm":"Hoàn tất đơn"}</button>:undefined}/>{next&&<section className="next-pick"><div><small>ĐIỂM LẤY TIẾP THEO</small><b>Line {next.line}{next.side} · Kệ {next.bay}</b><span>{next.name} · SL {next.quantity}</span></div><button onClick={()=>onMap(next)}>Mở vị trí →</button></section>}<div className="order-progress-large"><i><span style={{width:percent+"%"}}/></i><b>{percent}%</b></div>
    <div className="order-list">{sorted.map((p)=><article key={p.id} className={p.picked?"picked":""}><button className="pick-check" aria-label={p.picked?"Đánh dấu chưa lấy":"Đánh dấu đã lấy"} onClick={()=>onToggle(p)}>{p.picked?"✓":""}</button><div><small>SKU {p.sku}</small><b>{p.name}</b><span>Line {p.line}{p.side} · Kệ {p.bay}</span></div><div className="pick-quantity"><button disabled={p.quantity<=1} onClick={()=>onQuantity(p,p.quantity-1)}>−</button><b>{p.quantity}</b><button onClick={()=>onQuantity(p,p.quantity+1)}>+</button></div><StockBadge stock={p.stock}/><button onClick={()=>onMap(p)}>Vị trí</button><button className="danger-text" onClick={()=>onRemove(p)}>Bỏ</button></article>)}{!items.length&&<div className="empty big"><b>Đơn soạn đang trống</b><span>Tìm hoặc quét barcode rồi chọn “+ Đơn”.</span></div>}</div></div>;
}
function SuggestView({value,onValue,onGenerate,suggestions,onLine}:{value:string;onValue:(v:string)=>void;onGenerate:()=>void;suggestions:Array<{name:string;line:string;reason:string}>;onLine:(line:string)=>void}) {
  return <div><PageHead eyebrow="TRỢ LÝ NỘI BỘ" title="Gợi ý mua sắm" subtitle="Nhập món ăn hoặc sự kiện để gợi ý nhóm hàng và vị trí."/><div className="suggest-box"><input value={value} onChange={(e)=>onValue(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")onGenerate()}} placeholder="Ví dụ: lẩu, BBQ, tiệc sinh nhật…"/><button onClick={onGenerate}>✦ Phân tích</button></div><div className="suggestions">{suggestions.map((item,index)=><button key={index} onClick={()=>onLine(item.line)}><span>{String(index+1).padStart(2,"0")}</span><div><b>{item.name}</b><small>{item.reason}</small></div><strong>Line {item.line} →</strong></button>)}{!suggestions.length&&<div className="empty big">Nhập nhu cầu để bắt đầu gợi ý.</div>}</div></div>;
}
function ProductModal({value,onChange,onClose,onSave}:{value:Product;onChange:(p:Product)=>void;onClose:()=>void;onSave:()=>void}) {
  const set=(key:keyof Product,next:string|number)=>onChange({...value,[key]:next});
  return <div className="modal-backdrop"><section className="form-modal"><div className="modal-head"><div><p>MASTER DATA</p><h2>{value.id?"Chỉnh sửa sản phẩm":"Thêm sản phẩm"}</h2></div><button onClick={onClose}>×</button></div><div className="form-grid"><label>SKU<input value={value.sku} onChange={(e)=>set("sku",e.target.value)}/></label><label>Barcode<input value={value.barcode} onChange={(e)=>set("barcode",e.target.value)}/></label><label className="wide">Tên sản phẩm<input value={value.name} onChange={(e)=>set("name",e.target.value)}/></label><label>Line<input value={value.line} onChange={(e)=>set("line",e.target.value)}/></label><label>Mặt<select value={value.side} onChange={(e)=>set("side",e.target.value)}><option>A</option><option>B</option></select></label><label>Kệ<input type="number" min="1" value={value.bay} onChange={(e)=>set("bay",Number(e.target.value))}/></label><label>Giá<input type="number" min="0" value={value.price} onChange={(e)=>set("price",Number(e.target.value))}/></label><label>Tồn<input type="number" min="0" value={value.stock} onChange={(e)=>set("stock",Number(e.target.value))}/></label><label>Loss<input type="number" min="0" value={value.loss} onChange={(e)=>set("loss",Number(e.target.value))}/></label><label className="wide">Hạn sử dụng<input type="date" value={value.expDate} onChange={(e)=>set("expDate",e.target.value)}/></label></div><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" onClick={onSave}>Lưu sản phẩm</button></div></section></div>;
}
function LineConfigModal({value,onChange,onClose,onSave}:{value:LineConfig;onChange:(config:LineConfig)=>void;onClose:()=>void;onSave:()=>void}) {
  return <div className="modal-backdrop"><section className="form-modal line-config-modal"><div className="modal-head"><div><p>THIẾT LẬP SƠ ĐỒ</p><h2>Line {value.line}</h2></div><button onClick={onClose}>×</button></div><div className="line-config-preview" style={{"--line":value.color} as React.CSSProperties}><b>{value.logo||value.name}</b><span>LINE {value.line}</span></div><div className="form-grid"><label className="wide">Tên hiển thị<input value={value.name} maxLength={48} onChange={(e)=>onChange({...value,name:e.target.value})} placeholder="Ví dụ: Tea Drinks"/></label><label>Màu Line<input type="color" value={value.color} onChange={(e)=>onChange({...value,color:e.target.value.toUpperCase()})}/></label><label>Mã màu<input value={value.color} maxLength={7} onChange={(e)=>onChange({...value,color:e.target.value.toUpperCase()})} placeholder="#DFB100"/></label><label className="wide">Logo / biểu tượng<input value={value.logo} maxLength={36} onChange={(e)=>onChange({...value,logo:e.target.value})} placeholder="Ví dụ: TOPVALU, ★, 🥛 (để trống để hiện tên Line)"/></label></div><p className="form-note">Logo hỗ trợ chữ ngắn hoặc emoji. Để trống logo nếu muốn hiển thị tên Line ở giữa kệ.</p><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" onClick={onSave}>Lưu Line</button></div></section></div>;
}
function SettingsModal({actor,users,theme,onTheme,onRole,onClose}:{actor:Actor;users:UserRole[];theme:string;onTheme:(v:string)=>void;onRole:(id:string,role:Role)=>void;onClose:()=>void}) {
  return <div className="modal-backdrop"><section className="settings-modal"><div className="modal-head"><div><p>CÀI ĐẶT</p><h2>Giao diện & phân quyền</h2></div><button onClick={onClose}>×</button></div><h3>Màu chủ đạo</h3><div className="theme-row">{["forest","indigo","rose","graphite"].map((color)=><button key={color} className={theme===color?"active":""} data-color={color} onClick={()=>onTheme(color)}><i/>{color}</button>)}</div><h3>Tài khoản đã truy cập</h3><div className="user-list">{users.map((user)=><article key={user.userId}><span>{user.name.slice(0,2).toUpperCase()}</span><div><b>{user.name}</b><small>{user.email}</small></div>{actor.role==="ADMIN"&&user.userId!==actor.userId?<select value={user.role} onChange={(e)=>onRole(user.userId,e.target.value as Role)}><option>ADMIN</option><option>MANAGER</option><option>STAFF</option></select>:<em>{user.role}</em>}</article>)}</div><div className="modal-actions"><a className="ghost" href="/signout-with-chatgpt?return_to=/">Đăng xuất</a><button className="primary" onClick={onClose}>Đóng</button></div></section></div>;
}
function PogModal({modal,setModal,products,file,search,setSearch,canUpload,uploadRef,onUpload,onPick,onClose}:{modal:{line:string;side:"A"|"B";selectedId?:string};setModal:(v:{line:string;side:"A"|"B";selectedId?:string})=>void;products:Product[];file?:PogFile;search:string;setSearch:(v:string)=>void;canUpload:boolean;uploadRef:React.RefObject<HTMLInputElement|null>;onUpload:(f?:File)=>void;onPick:(p:Product)=>void;onClose:()=>void}) {
  const selected=products.find((p)=>p.id===modal.selectedId);
  const switchSide=(side:"A"|"B")=>{setSearch("");setModal({line:modal.line,side})};
  return <div className="modal-backdrop pog-backdrop"><section className="pog-modal"><div className="pog-head"><div><p>SƠ ĐỒ KỆ CHI TIẾT</p><h2>Line {modal.line} · {aisleNames[modal.line]||"Khu vực"}</h2></div><div className="side-switch"><button className={modal.side==="A"?"active":""} onClick={()=>switchSide("A")}>Mặt A</button><button className={modal.side==="B"?"active":""} onClick={()=>switchSide("B")}>Mặt B</button></div>{canUpload&&<button className="upload-pog" onClick={()=>uploadRef.current?.click()}>↑ Tải ảnh/PDF</button>}<button className="close-pog" onClick={onClose}>×</button></div>
    <div className="pog-body"><div className="pog-visual">{file?(file.mimeType==="application/pdf"?<iframe src={"/api/pog?id="+file.id} title="POG PDF"/>:<img src={"/api/pog?id="+file.id} alt={"POG Line "+modal.line}/>):<ShelfPlan products={products} selectedId={modal.selectedId}/>} {file&&file.mimeType!=="application/pdf"&&selected&&<div className="image-marker" style={{left:`${Math.min(91,8+selected.bay*10)}%`}}><i/><span>Kệ {selected.bay}<b>{selected.name}</b></span></div>}<div className="pog-file-label">{file?file.fileName:"Sơ đồ kệ tự động từ Master Data"}</div></div>
    <aside className="pog-list"><label>⌕<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Tìm SKU, barcode, tên…"/><b>{products.length} SP</b></label><div>{products.map((p)=><button key={p.id} className={p.id===modal.selectedId?"active":""} onClick={()=>setModal({...modal,selectedId:p.id})}><span>Kệ {p.bay}</span><div><small>SKU {p.sku}</small><b>{p.name}</b><em>{p.barcode}</em></div><StockBadge stock={p.stock}/></button>)}{!products.length&&<div className="empty big">Chưa có sản phẩm ở mặt kệ này.</div>}</div>{selected&&<section className="pog-selected"><div><b>Line {selected.line}{selected.side} · Kệ {selected.bay}</b><span>{selected.name}</span><small>Tồn {selected.stock} · Loss {selected.loss} · HSD {selected.expDate||"chưa có"}</small></div><button disabled={selected.stock===0} onClick={()=>onPick(selected)}>+ Thêm vào đơn</button></section>}</aside></div>
    <input ref={uploadRef} hidden type="file" accept="image/*,application/pdf" onChange={(e)=>onUpload(e.target.files?.[0])}/></section></div>;
}
function ShelfPlan({products,selectedId}:{products:Product[];selectedId?:string}) {
  return <div className="shelf-plan">{Array.from({length:8},(_,index)=>index+1).map((bay)=><div key={bay}><span>KỆ {bay}</span><section>{products.filter((p)=>p.bay===bay).map((p)=><article key={p.id} className={p.id===selectedId?"active":""}><small>{p.sku}</small><b>{p.name.slice(0,24)}</b></article>)}</section></div>)}</div>;
}
