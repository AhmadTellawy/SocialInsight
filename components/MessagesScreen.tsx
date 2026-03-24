
import React, { useState } from 'react';
import { ArrowLeft, Search, MoreHorizontal, Edit3, CheckCircle2, Users, MessageSquare } from 'lucide-react';

interface MessagesScreenProps {
  onBack: () => void;
}

const MOCK_CHATS = [
  { id: '1', name: 'Sarah Miller', avatar: 'https://randomuser.me/api/portraits/women/44.jpg', lastMsg: 'I really liked your latest poll on remote work!', time: '12:45 PM', unread: 2, online: true },
  { id: '2', name: 'Product Designers SF', avatar: 'https://images.unsplash.com/photo-1558655146-d09347e92766?w=100&h=100&fit=crop', lastMsg: 'Alex: New survey results are out.', time: 'Yesterday', unread: 0, online: false, isGroup: true },
  { id: '3', name: 'David Chen', avatar: 'https://randomuser.me/api/portraits/men/32.jpg', lastMsg: 'Thanks for the feedback on the coffee survey.', time: 'Tue', unread: 0, online: true },
  { id: '4', name: 'Tech Insider', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop', lastMsg: 'Collaboration invite: 2024 Tech Trends', time: 'Mon', unread: 0, online: false },
  { id: '5', name: 'Emily Wilson', avatar: 'https://randomuser.me/api/portraits/women/68.jpg', lastMsg: 'Sent a photo', time: 'Last week', unread: 0, online: false },
];

export const MessagesScreen: React.FC<MessagesScreenProps> = ({ onBack }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChats = MOCK_CHATS.filter(chat => 
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.lastMsg.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-4 h-16">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Messages</h1>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-2 text-gray-500 hover:bg-gray-50 rounded-full transition-colors">
            <Edit3 size={20} />
          </button>
          <button className="p-2 text-gray-500 hover:bg-gray-50 rounded-full transition-colors">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-gray-100 border-none rounded-2xl pl-11 pr-4 py-3 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/10 placeholder-gray-500 transition-all"
          />
        </div>
      </div>

      {/* Requests/Filters Row */}
      <div className="flex px-4 gap-4 pb-2 border-b border-gray-50">
        <button className="text-sm font-bold text-blue-600 pb-2 border-b-2 border-blue-600">All</button>
        <button className="text-sm font-bold text-gray-400 pb-2 border-b-2 border-transparent">Unread</button>
        <button className="text-sm font-bold text-gray-400 pb-2 border-b-2 border-transparent">Requests</button>
      </div>

      {/* Chats List */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
        {filteredChats.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {filteredChats.map((chat) => (
              <button 
                key={chat.id}
                className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors text-left relative active:scale-[0.98]"
              >
                {/* Avatar with Status */}
                <div className="relative shrink-0">
                  <img src={chat.avatar} alt={chat.name} className={`w-14 h-14 rounded-full object-cover border border-gray-100 ${chat.isGroup ? 'rounded-2xl' : ''}`} />
                  {chat.online && !chat.isGroup && (
                    <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 border-2 border-white rounded-full" />
                  )}
                  {chat.isGroup && (
                    <div className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-lg shadow-sm">
                      <div className="bg-blue-100 text-blue-600 p-0.5 rounded-md">
                        <Users size={10} strokeWidth={3} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <h4 className="font-bold text-gray-900 truncate flex items-center gap-1">
                      {chat.name}
                      {chat.online && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full hidden" />}
                    </h4>
                    <span className={`text-[10px] whitespace-nowrap ${chat.unread > 0 ? 'text-blue-600 font-bold' : 'text-gray-400 font-medium'}`}>
                      {chat.time}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <p className={`text-sm truncate ${chat.unread > 0 ? 'text-gray-900 font-bold' : 'text-gray-500 font-normal'}`}>
                      {chat.lastMsg}
                    </p>
                    {chat.unread > 0 && (
                      <div className="bg-blue-600 text-white text-[10px] font-black min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center animate-in zoom-in duration-300">
                        {chat.unread}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center text-gray-400">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
              <MessageSquare size={32} strokeWidth={1.5} />
            </div>
            <h3 className="text-gray-900 font-bold mb-1">No messages found</h3>
            <p className="text-sm">Try searching for a different name or start a new chat.</p>
          </div>
        )}
      </div>
    </div>
  );
};
