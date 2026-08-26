// 讓 IndexedDB 在 jsdom 環境下可用（測試專用，正式執行時用瀏覽器原生的）
import 'fake-indexeddb/auto';

// jsdom 沒有實作 Blob.arrayBuffer 以外的一些方法，這裡不需要補。
// 每個測試檔各自負責清掉自己造出來的資料。
