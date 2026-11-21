export function projectSamples(state) {
  const values = [state.sample, ...(Array.isArray(state.studio?.tracks) ? state.studio.tracks.map(track => track?.sample) : [])];
  return [...new Set(values.filter(Boolean))];
}

export function removeSample(state, file) {
  if (state.sample === file) state.sample = "";
  if (Array.isArray(state.studio?.tracks)) {
    for (const track of state.studio.tracks) {
      if (track?.sample === file) track.sample = "";
    }
  }
}

const networks = {
  instagram:["instagram.com"], soundcloud:["soundcloud.com","on.soundcloud.com"],
  spotify:["open.spotify.com"], linkedin:["linkedin.com"]
};

export function publicProfileSettings(input={}) {
  const label=(value,max)=>typeof value==="string"?value.trim().slice(0,max):"";
  const ids=value=>Array.isArray(value)?[...new Set(value.filter(id=>typeof id==="string"&&/^[a-f0-9-]{36}$/u.test(id)))].slice(0,50):[];
  const links={};
  for(const [name,hosts] of Object.entries(networks)) {
    const value=label(input.links?.[name],250);
    if(!value)continue;
    try {
      const url=new URL(value);
      if(url.protocol==="https:"&&!url.port&&!url.username&&!url.password&&hosts.includes(url.hostname.replace(/^www\./u,""))&&url.pathname!=="/")links[name]=url.href;
    } catch {}
  }
  return {country:label(input.country,48),gender:label(input.gender,48),links,posts:ids(input.posts),playlists:ids(input.playlists)};
}
