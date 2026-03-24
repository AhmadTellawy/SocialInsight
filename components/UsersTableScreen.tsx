import React, { useState, useEffect } from 'react';
import { ArrowLeft, Search, User, Globe, Calendar, Filter, MoreVertical, Download } from 'lucide-react';
import { api } from '../services/api';
import { UserProfile } from '../types';

interface UsersTableScreenProps {
    onBack: () => void;
    onUserClick?: (user: UserProfile) => void;
}

export const UsersTableScreen: React.FC<UsersTableScreenProps> = ({ onBack, onUserClick }) => {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCountry, setFilterCountry] = useState('All');

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const data = await api.getUsers();
                setUsers(data);
            } catch (error) {
                console.error("Failed to fetch users:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchUsers();
    }, []);

    const countries = ['All', ...Array.from(new Set(users.map(u => u.country).filter(Boolean)))];

    const filteredUsers = users.filter(u => {
        const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
            u.handle.toLowerCase().includes(search.toLowerCase());
        const matchesCountry = filterCountry === 'All' || u.country === filterCountry;
        return matchesSearch && matchesCountry;
    });

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        try {
            return new Date(dateStr).toLocaleDateString();
        } catch (e) {
            return '-';
        }
    };

    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3 bg-white sticky top-0 z-10">
                <button onClick={onBack} className="p-2 -ml-2 hover:bg-gray-50 rounded-full transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-black text-gray-900 flex-1">User Directory</h1>
                <button className="p-2 text-gray-400 hover:text-gray-600">
                    <Download size={20} />
                </button>
            </div>

            {/* Toolbar */}
            <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-3">
                <div className="relative">
                    <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search users..."
                        className="w-full bg-white border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none"
                    />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200/50 text-gray-600 rounded-lg text-xs font-bold shrink-0">
                        <Filter size={12} /> Filter:
                    </div>
                    {countries.map(c => (
                        <button
                            key={c as string}
                            onClick={() => setFilterCountry(c as string)}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 ${filterCountry === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                }`}
                        >
                            {c as string}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 overflow-auto no-scrollbar">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Loading Database...</p>
                    </div>
                ) : filteredUsers.length > 0 ? (
                    <div className="min-w-full inline-block align-middle">
                        <table className="min-w-full divide-y divide-gray-100">
                            <thead className="bg-gray-50/50">
                                <tr>
                                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">User</th>
                                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Birthday</th>
                                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Country</th>
                                    <th scope="col" className="px-4 py-3 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-50">
                                {filteredUsers.map((user) => (
                                    <tr
                                        key={user.handle}
                                        className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                                        onClick={() => onUserClick?.(user)}
                                    >
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <img className="h-10 w-10 rounded-xl object-cover border border-gray-100" src={user.avatar || 'https://picsum.photos/40/40'} alt="" />
                                                <div>
                                                    <div className="text-sm font-bold text-gray-900">{user.name}</div>
                                                    <div className="text-[10px] text-gray-400 font-medium">@{user.handle}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                                                <Calendar size={12} className="text-gray-400" />
                                                {formatDate(user.birthday)}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                                                <Globe size={12} className="text-gray-400" />
                                                {user.country || '-'}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-right text-[10px] font-medium">
                                            <button className="p-2 text-gray-300 hover:text-gray-600 transition-colors">
                                                <MoreVertical size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                        <User size={48} className="opacity-10 mb-4" />
                        <p className="text-sm font-bold uppercase tracking-widest">No users found</p>
                    </div>
                )}
            </div>

            {/* Footer Info */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-center">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                    Showing {filteredUsers.length} of {users.length} registered users
                </p>
            </div>
        </div>
    );
};
