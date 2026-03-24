import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Edit3, Trash2, AlertCircle, RefreshCw } from 'lucide-react';
import { Survey } from '../types';
import { api } from '../services/api';

interface DraftsListProps {
    userId: string;
    onBack: () => void;
    onEdit: (draft: Survey) => void;
    onDelete?: (draftId: string) => void;
}

export const DraftsList: React.FC<DraftsListProps> = ({ userId, onBack, onEdit, onDelete }) => {
    const [drafts, setDrafts] = useState<Survey[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadDrafts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getDrafts(userId);
            setDrafts(data);
        } catch (err) {
            console.error("Failed to load drafts", err);
            setError("Failed to load drafts. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadDrafts();
    }, [loadDrafts]);

    const handleDelete = async (e: React.MouseEvent, draft: Survey) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this draft?')) return;

        const previousDrafts = [...drafts];
        setDrafts(prev => prev.filter(d => d.id !== draft.id));

        if (onDelete) {
            onDelete(draft.id);
        }

        try {
            if ((api as any).deleteDraft) {
                await (api as any).deleteDraft(draft.id);
            }
        } catch (err) {
            console.error("Failed to delete draft", err);
            setDrafts(previousDrafts);
            alert("Failed to delete draft. Please try again.");
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    };

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="flex items-center px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
                <button type="button" onClick={onBack} aria-label="Go back" className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full">
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-lg font-bold ml-2">My Drafts</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="text-center py-10 text-gray-400">Loading drafts...</div>
                ) : error ? (
                    <div className="text-center py-20 flex flex-col items-center">
                        <AlertCircle size={48} className="text-red-400 mb-4 opacity-50" />
                        <h3 className="text-lg font-bold text-gray-900 mb-2">Oops!</h3>
                        <p className="text-gray-500 text-sm mb-6">{error}</p>
                        <button
                            type="button"
                            onClick={loadDrafts}
                            className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-full font-bold text-sm hover:bg-gray-800 transition-colors"
                        >
                            <RefreshCw size={16} /> Retry
                        </button>
                    </div>
                ) : drafts.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                            <Edit3 size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">No Drafts Yet</h3>
                        <p className="text-gray-500 text-sm mt-2">Start creating a post and save it as draft to see it here.</p>
                    </div>
                ) : (
                    drafts.map((draft) => (
                        <div
                            key={draft.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onEdit(draft)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onEdit(draft);
                                }
                            }}
                            aria-label={`Edit draft: ${draft.title || "Untitled Draft"}`}
                            className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm active:scale-[0.99] transition-all cursor-pointer hover:border-blue-100 hover:shadow-md group relative outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                            <div className="flex justify-between items-start">
                                <div className="flex-1 pr-16">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-wider rounded-md">{draft.type}</span>
                                        <span className="text-[10px] text-gray-400">
                                            {formatDate((draft as any).updatedAt || draft.createdAt)}
                                        </span>
                                    </div>
                                    <h3 className="font-bold text-gray-900 line-clamp-1">{draft.title || "Untitled Draft"}</h3>
                                    <p className="text-sm text-gray-500 line-clamp-2 mt-1">{draft.description || "No description"}</p>
                                </div>
                            </div>
                            <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-full pointer-events-none" aria-hidden="true">
                                    <Edit3 size={16} />
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => handleDelete(e, draft)}
                                    className="p-2 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors z-10 relative focus-visible:ring-2 focus-visible:ring-red-500 outline-none"
                                    aria-label="Delete draft"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
