import React, { useState, useCallback } from 'react';
import {
  Loader,
  RefreshCw,
  ExternalLink,
  Heart,
  MessageCircle,
  Share2,
  Eye,
  TrendingUp,
  ChevronDown,
} from '@geist-ui/icons';
import { useFirestoreAccounts } from '../hooks/useFirestore';

// ─── Types ────────────────────────────────────────────────

interface NormalizedPost {
  id: string;
  platform: string;
  type: string;
  text: string;
  media: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  date: string;
  url: string;
  engagement: number;
}

interface PlatformData {
  platform: string;
  username: string;
  followerCount?: number;
  posts: NormalizedPost[];
}

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', color: '#E1306C', handleKey: 'instagram' },
  { id: 'facebook', label: 'Facebook', color: '#1877F2', handleKey: 'facebook' },
  { id: 'tiktok', label: 'TikTok', color: '#00F2EA', handleKey: 'tiktok' },
  { id: 'twitter', label: 'X / Twitter', color: '#1DA1F2', handleKey: 'twitter' },
];

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Component ────────────────────────────────────────────

export default function SocialAnalytics() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [platformData, setPlatformData] = useState<Record<string, PlatformData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'likes' | 'comments' | 'views' | 'engagement'>('date');

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null;
  const handles = selectedAccount?.socialHandles || {};

  const fetchPlatform = useCallback(async (platform: string, username: string) => {
    setLoading(prev => ({ ...prev, [platform]: true }));
    setErrors(prev => { const n = { ...prev }; delete n[platform]; return n; });
    try {
      const res = await fetch(`/api/social/${platform}/${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlatformData(prev => ({ ...prev, [platform]: data }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [platform]: e.message }));
    } finally {
      setLoading(prev => ({ ...prev, [platform]: false }));
    }
  }, []);

  const fetchAll = useCallback(() => {
    PLATFORMS.forEach(p => {
      const handle = handles[p.handleKey];
      if (handle) fetchPlatform(p.id, handle.replace('@', ''));
    });
  }, [handles, fetchPlatform]);

  const availablePlatforms = PLATFORMS.filter(p => handles[p.handleKey]);
  const isAnyLoading = Object.values(loading).some(Boolean);

  // Aggregate all posts
  const allPosts: NormalizedPost[] = Object.values(platformData)
    .flatMap(d => d.posts)
    .sort((a, b) => {
      switch (sortBy) {
        case 'likes': return b.likes - a.likes;
        case 'comments': return b.comments - a.comments;
        case 'views': return b.views - a.views;
        case 'engagement': return b.engagement - a.engagement;
        default: return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
    });

  const filteredPosts = activeTab === 'all'
    ? allPosts
    : allPosts.filter(p => p.platform === activeTab);

  // Top performer stats
  const topByLikes = [...allPosts].sort((a, b) => b.likes - a.likes)[0];
  const topByViews = [...allPosts].sort((a, b) => b.views - a.views)[0];
  const topByEngagement = [...allPosts].sort((a, b) => b.engagement - a.engagement)[0];
  const avgEngagement = allPosts.length
    ? (allPosts.reduce((s, p) => s + p.engagement, 0) / allPosts.length).toFixed(2)
    : '0';

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Account Selector */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Select Brand</h3>
        {accountsLoading ? (
          <p className="text-sm text-zinc-600">Loading...</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => { setSelectedAccountId(acct.id); setPlatformData({}); setErrors({}); }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  selectedAccountId === acct.id
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : 'border-[#27273A] hover:bg-[#181824]'
                }`}
              >
                <img
                  src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=28`}
                  alt="" className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAccount && (
        <>
          {/* Platform Handles + Fetch */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Connected Platforms</h3>
              <button
                onClick={fetchAll}
                disabled={isAnyLoading || availablePlatforms.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40"
              >
                {isAnyLoading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {isAnyLoading ? 'Fetching...' : 'Fetch All'}
              </button>
            </div>

            {availablePlatforms.length === 0 ? (
              <p className="text-xs text-zinc-500">No social handles set. Add them in the CRM account settings.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map(p => {
                  const handle = handles[p.handleKey]!;
                  const data = platformData[p.id];
                  const isLoading = loading[p.id];
                  const error = errors[p.id];
                  return (
                    <button
                      key={p.id}
                      onClick={() => fetchPlatform(p.id, handle.replace('@', ''))}
                      disabled={isLoading}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                        data ? 'border-emerald-500/30 bg-emerald-500/5' : error ? 'border-red-500/30 bg-red-500/5' : 'border-[#27273A] hover:border-zinc-600'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-[11px] text-zinc-300 font-medium">{p.label}</span>
                      <span className="text-[10px] text-zinc-500">@{handle.replace('@', '')}</span>
                      {isLoading && <Loader size={10} className="animate-spin text-zinc-400" />}
                      {data && <span className="text-[9px] text-emerald-400">{data.posts.length} posts</span>}
                      {error && <span className="text-[9px] text-red-400">Error</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {Object.entries(errors).map(([platform, msg]) => (
              <p key={platform} className="text-[10px] text-red-400 mt-2">{platform}: {msg}</p>
            ))}
          </div>

          {/* Stats Overview */}
          {allPosts.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total Posts', value: allPosts.length.toString(), icon: <TrendingUp size={16} />, color: 'text-purple-400' },
                { label: 'Avg Engagement', value: avgEngagement + '%', icon: <Heart size={16} />, color: 'text-pink-400' },
                { label: 'Top Post Likes', value: topByLikes ? formatNum(topByLikes.likes) : '0', icon: <Heart size={16} />, color: 'text-red-400' },
                { label: 'Top Post Views', value: topByViews ? formatNum(topByViews.views) : '0', icon: <Eye size={16} />, color: 'text-blue-400' },
              ].map((stat, i) => (
                <div key={i} className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={stat.color}>{stat.icon}</span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{stat.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Platform tabs + Sort */}
          {allPosts.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                    activeTab === 'all' ? 'bg-purple-500/15 border-purple-500/30 text-purple-300' : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  All
                </button>
                {PLATFORMS.filter(p => platformData[p.id]).map(p => (
                  <button
                    key={p.id}
                    onClick={() => setActiveTab(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                      activeTab === p.id ? 'bg-purple-500/15 border-purple-500/30 text-purple-300' : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1 text-[11px] text-zinc-300 outline-none"
                >
                  <option value="date">Latest</option>
                  <option value="likes">Most Likes</option>
                  <option value="comments">Most Comments</option>
                  <option value="views">Most Views</option>
                  <option value="engagement">Engagement Rate</option>
                </select>
              </div>
            </div>
          )}

          {/* Posts Grid */}
          {filteredPosts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPosts.map((post) => {
                const pConfig = PLATFORMS.find(p => p.id === post.platform);
                return (
                  <div key={post.id + post.platform} className="bg-[#12121A] border border-[#27273A] rounded-2xl overflow-hidden hover:border-zinc-600 transition-colors">
                    {/* Media */}
                    {post.media && (
                      <div className="aspect-square bg-[#0A0A0F] overflow-hidden">
                        <img src={post.media} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}

                    <div className="p-4">
                      {/* Platform + type badge */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pConfig?.color }} />
                          <span className="text-[10px] text-zinc-500 font-medium capitalize">{post.platform}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#27273A] text-zinc-400 capitalize">{post.type}</span>
                        </div>
                        <span className="text-[9px] text-zinc-600">{timeAgo(post.date)}</span>
                      </div>

                      {/* Caption */}
                      <p className="text-[11px] text-zinc-300 line-clamp-3 leading-relaxed mb-3">
                        {post.text || 'No caption'}
                      </p>

                      {/* Stats */}
                      <div className="flex items-center gap-3 text-zinc-500">
                        <div className="flex items-center gap-1" title="Likes">
                          <Heart size={12} />
                          <span className="text-[10px] font-medium">{formatNum(post.likes)}</span>
                        </div>
                        <div className="flex items-center gap-1" title="Comments">
                          <MessageCircle size={12} />
                          <span className="text-[10px] font-medium">{formatNum(post.comments)}</span>
                        </div>
                        <div className="flex items-center gap-1" title="Shares">
                          <Share2 size={12} />
                          <span className="text-[10px] font-medium">{formatNum(post.shares)}</span>
                        </div>
                        {post.views > 0 && (
                          <div className="flex items-center gap-1" title="Views">
                            <Eye size={12} />
                            <span className="text-[10px] font-medium">{formatNum(post.views)}</span>
                          </div>
                        )}
                        {post.engagement > 0 && (
                          <span className="ml-auto text-[9px] font-mono text-emerald-400" title="Engagement Rate">
                            {post.engagement}%
                          </span>
                        )}
                      </div>

                      {/* Link */}
                      {post.url && (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 mt-2 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
                        >
                          <ExternalLink size={10} /> View on {post.platform}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {allPosts.length === 0 && !isAnyLoading && availablePlatforms.length > 0 && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-12 text-center">
              <TrendingUp size={40} className="mx-auto mb-3 text-zinc-700" />
              <p className="text-sm text-zinc-500">Click "Fetch All" to pull in the latest posts</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
