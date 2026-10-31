import { createContext, useContext } from 'react';
export const ReelEditorContext = createContext(false);
export const useReelEditor = () => useContext(ReelEditorContext);
