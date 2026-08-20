"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Product = {
  id: string; sku: string; barcode: string; name: string; line: string;
  side: "A" | "B"; bay: number; price: number; stock: number; loss: number; expDate: string;
};

const products: Product[] = [
  { id:"p1", sku:"10531914", barcode:"45497410531914", name:"HC TẤM TRẢI LÀM MÁT ICECOLD 160X200GY", line:"12", side:"A", bay:3, price:450000, stock:5, loss:0, expDate:"2026-12-31" },
  { id:"p2", sku:"10763049", barcode:"45497410763049", name:"HC GỐI MOCHI PILLOW BE", line:"12", side:"B", bay:2, price:185000, stock:45, loss:2, expDate:"2026-06-15" },
  { id:"p3", sku:"8969583", barcode:"8801260418800", name:"BVS SOONSOOHANMYEON 23CM 18 MIẾNG", line:"16", side:"A", bay:5, price:45000, stock:0, loss:0, expDate:"2027-01-10" },
];

const aisleNames: Record<string, string> = {
  "01":"Souvenir", "02":"Chocolate", "03":"Fruit", "04":"Confectionery", "05":"Milk", "06":"Milk",
  "07":"Kids", "08":"Kids", "09":"Nonfood", "10":"Home Coordy", "11":"Home Coordy", "12":"Household",
  "13":"Household", "14":"Nonfood", "15":"Nonfood", "16":"Nonfood", "17":"Beer & Liquor", "18":"Tea & Drinks",
  "19":"Coffee", "20":"Topvalu", "21":"Topvalu", "22":"Asia", "23":"Asia", "24":"Noodles", "25":"Rice",
  "26":"Sauces", "27":"Spices", "28":"Seafood"
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const money = new Intl.NumberFormat("vi-VN");

function StockTag({ stock }: { stock: number }) {
  if (stock === 0) return <span className="tag tag-out">Hết hàng</span>;
  if (stock < 10) return <span className="tag tag-low">Sắp hết · {stock}</span>;
  return <span className="tag tag-ok">Còn hàng · {stock}</span>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "available" | "out">("all");
  const [selectedId, setSelectedId] = useState(products[0].id);
  const [picking, setPicking] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [view, setView] = useState<"search" | "map">("search");
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = normalize(query);
    return products.filter((product) => {
      const matches = !needle || normalize(`${product.name} ${product.sku} ${product.barcode} ${product.line}`).includes(needle);
      const matchesFilter = filter === "all" || (filter === "available" ? product.stock > 0 : product.stock === 0);
      return matches && matchesFilter;
    });
  }, [query, filter]);

  const selected = products.find((product) => product.id === selectedId) ?? results[0] ?? products[0];
  const progress = picking.length ? Math.round((picked.length / picking.length) * 100) : 0;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "F2") { event.preventDefault(); setView("search"); requestAnimationFrame(() => searchRef.current?.focus()); }
      if (event.key === "Escape") { setView("search"); setQuery(""); }
      if (event.key === "Enter" && document.activeElement === searchRef.current && results[0]) {
        setSelectedId(results[0].id);
        if (window.innerWidth < 860) setView("map");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [results]);

  const choose = (product: Product) => { setSelectedId(product.id); if (window.innerWidth < 860) setView("map"); };
  const toggleOrder = (id: string) => {
    setPicking((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setPicked((current) => current.filter((item) => item !== id));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => searchRef.current?.focus()} aria-label="Tập trung vào ô tìm kiếm"><b>F</b><span>FULFILLMENT<br/>HELPER</span></button>
        <div className="shift"><i /> Đang trực · Quầy 01</div>
        <div className="order-progress">
          <div><small>ĐƠN ĐANG SOẠN</small><strong>{picked.length}/{picking.length || 0} sản phẩm</strong></div>
          <div className="progress-track"><span style={{width:`${progress}%`}} /></div>
        </div>
        <button className="avatar" aria-label="Tài khoản nhân viên">NV</button>
      </header>

      <section className="workspace">
        <aside className="rail" aria-label="Điều hướng">
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}><span>⌕</span>Tìm hàng</button>
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><span>▦</span>Sơ đồ</button>
          <button onClick={() => searchRef.current?.focus()}><span>▤</span>Đơn soạn<b>{picking.length}</b></button>
        </aside>

        <div className={`search-panel ${view === "map" ? "mobile-hidden" : ""}`}>
          <div className="panel-intro"><p>TRỢ LÝ SOẠN ĐƠN</p><h1>Tìm đúng hàng,<br/><em>không đi vòng.</em></h1></div>
          <label className="search-box">
            <span>⌕</span>
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên sản phẩm, SKU hoặc barcode..." aria-label="Tìm tên sản phẩm, SKU hoặc barcode" autoFocus />
            {query && <button onClick={() => setQuery("")} aria-label="Xóa tìm kiếm">×</button>}
            <kbd>F2</kbd>
          </label>
          <div className="filter-row">
            <div className="filters" role="group" aria-label="Lọc tồn kho">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Tất cả <b>3</b></button>
              <button className={filter === "available" ? "active" : ""} onClick={() => setFilter("available")}>Còn hàng <b>2</b></button>
              <button className={filter === "out" ? "active" : ""} onClick={() => setFilter("out")}>Hết hàng <b>1</b></button>
            </div>
            <span>{results.length} kết quả</span>
          </div>

          <div className="results" aria-live="polite">
            {results.length ? results.map((product) => (
              <article key={product.id} className={`result-card ${selected.id === product.id ? "selected" : ""}`} onClick={() => choose(product)}>
                <div className={`thumb thumb-${product.line}`}><small>LINE</small><strong>{product.line}</strong></div>
                <div className="result-copy">
                  <div className="sku-line"><span>SKU {product.sku}</span><StockTag stock={product.stock}/></div>
                  <h2>{product.name}</h2>
                  <p>{aisleNames[product.line]} · Dãy {product.line}{product.side} · Kệ {product.bay}</p>
                  <strong className="price">{money.format(product.price)} đ</strong>
                </div>
                <button className={`add-button ${picking.includes(product.id) ? "added" : ""}`} onClick={(event) => { event.stopPropagation(); toggleOrder(product.id); }} aria-label={picking.includes(product.id) ? "Bỏ khỏi đơn soạn" : "Thêm vào đơn soạn"}>{picking.includes(product.id) ? "✓" : "+"}</button>
              </article>
            )) : (
              <div className="no-results"><b>Không tìm thấy sản phẩm</b><p>Thử nhập mã SKU, barcode hoặc một phần tên sản phẩm.</p><button onClick={() => {setQuery("");setFilter("all");}}>Xem tất cả sản phẩm</button></div>
            )}
          </div>
        </div>

        <aside className={`location-panel ${view === "search" ? "mobile-hidden" : ""}`}>
          <div className="location-head">
            <div><p>VỊ TRÍ SẢN PHẨM</p><h2>Dãy {selected.line}{selected.side} · Kệ {selected.bay}</h2></div>
            <button className="back-mobile" onClick={() => setView("search")}>← Kết quả</button>
          </div>
          <div className="map-card">
            <div className="map-legend"><span><i className="you"/>Vị trí của bạn</span><span><i className="target"/>Sản phẩm</span></div>
            <div className="store-map">
              <div className="daily">DAILY<br/><small>FRESH FOOD</small></div>
              <div className="entrance"><span>●</span><small>BẠN Ở ĐÂY</small></div>
              <div className="aisles">
                {Object.keys(aisleNames).map((line) => <button key={line} className={selected.line === line ? "target-aisle" : ""} onClick={() => { const item=products.find(p=>p.line===line); if(item) setSelectedId(item.id); }}><small>{aisleNames[line]}</small><strong>{line}</strong><span>A&nbsp;&nbsp;B</span></button>)}
              </div>
              <div className="route-line"><i/><i/><i/><i/></div>
            </div>
          </div>

          <section className="location-detail">
            <div className={`mini-thumb thumb-${selected.line}`}><small>LINE</small><strong>{selected.line}</strong></div>
            <div><p>SKU {selected.sku}</p><h3>{selected.name}</h3><span>Đi thẳng đến dãy <b>{selected.line}{selected.side}</b>, tìm kệ số <b>{selected.bay}</b>.</span></div>
          </section>
          <div className="action-row">
            <button className="secondary" onClick={() => toggleOrder(selected.id)}>{picking.includes(selected.id) ? "Bỏ khỏi đơn" : "+ Thêm vào đơn"}</button>
            <button className="primary" disabled={!picking.includes(selected.id) || selected.stock === 0} onClick={() => setPicked((current) => current.includes(selected.id) ? current.filter(id => id !== selected.id) : [...current, selected.id])}>{selected.stock === 0 ? "Hết hàng" : picked.includes(selected.id) ? "✓ Đã lấy hàng" : "Xác nhận đã lấy"}</button>
          </div>
          <div className="stock-note"><span>i</span><p><b>Tồn kho khả dụng: {selected.stock}</b><br/>Hao hụt ghi nhận: {selected.loss} · HSD: {new Date(selected.expDate).toLocaleDateString("vi-VN")}</p></div>
        </aside>
      </section>
      <footer><span>F2 · Tìm nhanh</span><span>ENTER · Chọn sản phẩm</span><span>ESC · Quay lại</span><b>Dữ liệu cập nhật lúc 22:36</b></footer>
    </main>
  );
}
