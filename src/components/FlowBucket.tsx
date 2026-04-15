import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Trash2, ChevronUp, ChevronDown, Image, Loader } from '@geist-ui/icons';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../lib/firebase';

// ─── Types ────────────────────────────────────────────────

export interface FlowBucketItem {
  id: string;
  name: string;
  url: string;        // Firebase Storage URL
  storagePath: string; // for cleanup
  mimeType: string;
  timestamp: number;
}

const STORAGE_KEY = 'bdai-flow-bucket';

function loadItems(): FlowBucketItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveItems(items: FlowBucketItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 30))); } catch {}
}

// ─── Global event for cross-component updates ─────────────

type BucketListener = (items: FlowBucketItem[]) => void;
const listeners = new Set<BucketListener>();

export async function addToFlowBucket(input: { name: string; base64: string; mimeType: string }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Use a data URL immediately so the item appears in the bucket right away
  let url = `data:${input.mimeType};base64,${input.base64}`;
  let storagePath = '';

  // Try uploading to Firebase Storage in the background — swap the URL if it succeeds
  try {
    storagePath = `flow-bucket/${id}.png`;
    const storageRef = ref(storage, storagePath);
    const bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0));
    await uploadBytes(storageRef, bytes, { contentType: input.mimeType });
    url = await getDownloadURL(storageRef);
  } catch {
    // Firebase upload failed — keep using the data URL
    storagePath = '';
  }

  const item: FlowBucketItem = {
    id,
    name: input.name,
    url,
    storagePath,
    mimeType: input.mimeType,
    timestamp: Date.now(),
  };

  const items = loadItems();
  const updated = [item, ...items].slice(0, 30);
  saveItems(updated);
  listeners.forEach(fn => fn(updated));
}

// ─── Drop target hook ─────────────────────────────────────

// onReceive gets a URL string — the component fetches it and converts to base64 if needed
export function useFlowBucketDrop(onReceive: (item: FlowBucketItem) => void) {
  const [dragOver, setDragOver] = useState(false);
  const onReceiveRef = useRef(onReceive);
  onReceiveRef.current = onReceive;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Accept drops that have our custom type
    if (e.dataTransfer.types.includes('text/x-flow-id')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const itemId = e.dataTransfer.getData('text/x-flow-id');
    if (itemId) {
      const items = loadItems();
      const item = items.find(i => i.id === itemId);
      if (item) onReceiveRef.current(item);
    }
  }, []);

  return { dragOver, handleDragOver, handleDragLeave, handleDrop };
}

// Helper: fetch a flow bucket item's image as base64
export async function flowItemToBase64(item: FlowBucketItem): Promise<{ base64: string; mimeType: string; preview: string }> {
  // If already a data URL, extract directly — no need to proxy
  if (item.url.startsWith('data:')) {
    return {
      base64: item.url.split(',')[1],
      mimeType: item.mimeType,
      preview: item.url,
    };
  }

  const res = await fetch(`/api/content/image-proxy?url=${encodeURIComponent(item.url)}`);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({
        base64: dataUrl.split(',')[1],
        mimeType: blob.type || item.mimeType,
        preview: dataUrl,
      });
    };
    reader.readAsDataURL(blob);
  });
}

// ─── Component ────────────────────────────────────────────

export default function FlowBucket() {
  const [items, setItems] = useState<FlowBucketItem[]>(loadItems);
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(() => loadItems().length > 0);
  const [uploading, setUploading] = useState(false);

  // Listen for external additions
  useEffect(() => {
    const listener: BucketListener = (updated) => {
      setItems(updated);
      setVisible(true);
      setCollapsed(false);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const removeItem = async (id: string) => {
    const item = items.find(i => i.id === id);
    // Delete from Firebase Storage
    if (item?.storagePath) {
      try { await deleteObject(ref(storage, item.storagePath)); } catch {}
    }
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    saveItems(updated);
    if (updated.length === 0) setVisible(false);
  };

  const clearAll = async () => {
    // Delete all from Firebase Storage
    for (const item of items) {
      if (item.storagePath) {
        try { await deleteObject(ref(storage, item.storagePath)); } catch {}
      }
    }
    setItems([]);
    saveItems([]);
    setVisible(false);
  };

  const handleDragStart = (e: React.DragEvent, item: FlowBucketItem) => {
    // Set the item ID as transfer data — small string, always works
    e.dataTransfer.setData('text/x-flow-id', item.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  if (!visible && items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40" style={{ maxWidth: collapsed ? 200 : 400 }}>
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-[#181824] transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-white">Flow Bucket</span>
            <span className="text-[9px] text-zinc-500 bg-[#27273A] px-1.5 py-0.5 rounded-full">{items.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors"
                title="Clear all"
              >
                <Trash2 size={12} />
              </button>
            )}
            {collapsed ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
          </div>
        </div>

        {/* Body */}
        {!collapsed && (
          <div className="px-3 pb-3">
            {items.length === 0 ? (
              <div className="text-center py-4">
                <Image size={20} className="mx-auto mb-1.5 text-zinc-700" />
                <p className="text-[10px] text-zinc-600">Generated graphics appear here</p>
                <p className="text-[9px] text-zinc-700">Drag them to any upload zone</p>
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 pt-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                    className="group relative shrink-0 cursor-grab active:cursor-grabbing"
                  >
                    <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-[#27273A] hover:border-purple-500/40 transition-colors bg-[#0A0A0F]">
                      <img src={item.url} alt="" className="w-full h-full object-contain" draggable={false} crossOrigin="anonymous" />
                    </div>
                    <p className="text-[8px] text-zinc-500 mt-0.5 truncate w-20 text-center">{item.name}</p>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="absolute -top-1 -right-1 p-0.5 rounded-full bg-[#12121A] border border-[#27273A] text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[8px] text-zinc-700 mt-1 text-center">Drag & drop into any upload area</p>
          </div>
        )}
      </div>
    </div>
  );
}
