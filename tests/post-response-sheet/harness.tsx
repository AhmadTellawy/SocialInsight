import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SurveyCard } from '../../components/SurveyCard';
import { SurveyType, type Survey, type Option, type UserProfile } from '../../types';
import i18n from '../../i18n';
import '../../styles/tailwind.css';
import { installSheetHistory } from '../../utils/sheetHistory';

installSheetHistory();
const params = new URLSearchParams(location.search);
const arabic = params.get('lang') === 'ar';
await i18n.changeLanguage(arabic ? 'ar' : 'en');
document.documentElement.dir = arabic ? 'rtl' : 'ltr';
const image = (color: string, width=640, height=480) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><rect width="100%" height="100%" fill="'+color+'"/><circle cx="50%" cy="40%" r="70" fill="#ffffff"/><path d="M0 '+height+' L'+width/2+' '+height/2+' L'+width+' '+height+' Z" fill="#ffffff" opacity=".3"/></svg>');
const layout = params.get('layout') || 'text';
const cover=image('#24545f',640,800);
const options: Option[]=Array.from({length:5},(_,i)=>({id:'option-'+i,text:arabic?'الخيار '+(i+1):'Photo '+String.fromCharCode(65+i),votes:10-i,image:layout==='text'?undefined:image(['#146579','#e7b27b','#52806f','#855948','#264366'][i],i===0?400:640,i===0?650:480),withFollowUp:params.has('followup')&&i===0,followUpLabel:'Tell us why'}));
const type=({survey:SurveyType.SURVEY,quiz:SurveyType.QUIZ,challenge:SurveyType.CHALLENGE} as const)[params.get('mode') || ''] || SurveyType.POLL;
const base:Survey={id:'response-sheet-fixture',title:arabic?'أي صورة نختار للمنشور القادم؟':'Which photo should we feature next?',description:'',type,participants:40,likes:0,commentsCount:0,isTrending:false,status:'PUBLISHED',author:{id:'fixture-author',name:'Emma Wilson',avatar:image('#64748b')},options:params.has('rating')?options.map((o,i)=>({...o,isRating:true,ratingValue:i+1,text:String(i+1)})):options,
  coverImage:params.get('media')==='none'||params.get('media')==='album'?undefined:cover,
  media:params.get('media')==='album'?[cover,image('#7068a3',800,480)].map((src,i)=>({id:'post-image-'+i,access:'PUBLIC',src,width:i?800:640,height:i?480:800,aspectRatio:i?800/480:.8,altText:'Post image '+(i+1)})):undefined,
  imageLayout:layout==='vertical'?'vertical':'horizontal',optionPresentation:layout==='text'?'text':'image',showOptionNames:!params.has('hidden'),allowAnonymous:true,forceAnonymous:params.has('forced'),allowMultipleSelection:params.has('multi'),allowUserOptions:params.has('custom'),pollChoiceType:params.has('rating')?'rating':'text',resultsVisibility:params.has('private')?'Private':'Public',resultsWho:'Public',resultsTiming:'Immediately',createdAt:'2026-10-12T12:00:00Z',expiresAt:params.has('expired')?'2020-01-01T00:00:00Z':undefined,hasParticipated:params.has('done'),userSelectedOptions:params.has('done')?['option-1']:[],demographics:params.has('demographics')?['gender']:[],
  sections:type===SurveyType.SURVEY||type===SurveyType.QUIZ?[{id:'section-1',title:'',questions:[{id:'question-1',text:'Choose a photo',type:'multiple_choice',options,imageLayout:layout==='horizontal'?'horizontal':'vertical',isRequired:true,correctOptionId:'option-0'},{id:'question-2',text:'Choose another photo',type:'multiple_choice',options,imageLayout:'vertical',isRequired:true,correctOptionId:'option-1'}]}]:undefined};
const viewer={id:'fixture-author',name:'Emma Wilson',handle:'fixture',avatar:'',demographics:{},groups:[],interests:[],type:'Personal'} as UserProfile;
function Harness(){
  const [survey,setSurvey]=useState(base);const [receipt,setReceipt]=useState<unknown[]>([]);
  return <BrowserRouter><main className="mx-auto max-w-md bg-white" data-testid="fixture">
    <SurveyCard survey={params.has('repost')?{...survey,id:'repost-fixture',sharedFrom:survey}:survey} userProfile={viewer} isDetailView={params.has('detail')} sourceSurface={params.has('capture')?'SHARE_CAPTURE':'FEED'} onContentClick={()=>setReceipt(r=>[...r,{navigate:true}])}
      onVote={async (id,selected,anonymous,custom,followUp,answers)=>{
        setReceipt(r=>[...r,{id,selected,anonymous,custom,followUp,answers}]);
        if(params.has('fail'))return false;
        setSurvey(s=>({...s,hasParticipated:true,userSelectedOptions:selected,participants:s.participants+1,options:[...s.options,...(custom?[custom]:[])].map(o=>({...o,votes:o.votes+(selected.includes(o.id)?1:0)}))}));
        return true;
      }}
    />
    <output data-testid="receipt" className="block whitespace-pre-wrap break-words p-3 text-xs">{JSON.stringify(receipt)}</output>
  </main></BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
