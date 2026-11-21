const TABS = [["lib","Biblioteca"],["syn","Estudio"],["ddj","Larp DDJ"],["eq","EQ y DAC"],["pl","Comunidad"],["fr","Amigos"],["pr","Perfil"]];
const NAV_ICONS = {lib:"♫",syn:"▥",ddj:"◉",eq:"≋",pl:"◇",fr:"◎",pr:"◉"};
const AUDIO_EXT = ".mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.wma,.aiff,.aif,.ape,.alac,.amr,.mid,.midi,.mka,.weba,.webm,.mp2,.ac3,.dts,.wv,.caf,.au,.dsf,.dff";
const IMAGES = "image/jpeg,image/png,image/webp,image/gif";
const STICKERS = ["🔥", "🎧", "🎵", "🙌", "💜", "🎛️", "🥁", "🚀"];
const TASTES = ["Rock","Pop","Hip-hop","Electrónica","Jazz","Salsa","Reggaetón","Clásica","Metal","Indie","Lo-fi","Cumbia","R&B","Folk"];

const session = {
  user:null, page:"lib", trackIndex:-1, tracks:[], savedTracks:[], localTracks:[], playlists:[],
  activeFriend:"", closeChat:()=>{}, authMode:"login", inviteToken:new URL(location.href).searchParams.get("invite")||"",
  invite:null, inviteMessage:"", loadingSession:true, viewVersion:0, ddjPreferences:null, storage:null, pendingUploads:[], libraryLoadedOwner:"", uploadBatch:null, communityDraft:null
};
const navigation = {go:()=>{}};
const studioHooks = {isRecording:()=>false,stop:()=>{},setTempo:()=>{},addClip:()=>{}};
const djHooks = {preferences:()=>{},reset:()=>{},rateChange:()=>{},recording:()=>false,refresh:()=>{}};

export { AUDIO_EXT, IMAGES, NAV_ICONS, STICKERS, TABS, TASTES, djHooks, navigation, session, studioHooks };
