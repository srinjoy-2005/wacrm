import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('/home/iamsrinjoy/important-stuff/wacrm/src');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // DB Table names
  content = content.replace(/\.from\('tags'\)/g, ".from('collections')");
  content = content.replace(/\.from\('contact_tags'\)/g, ".from('collection_members')");
  content = content.replace(/\.from\('flow_runs'\)/g, ".from('sessions')");
  content = content.replace(/\.from\('flow_run_events'\)/g, ".from('session_events')");
  
  // RPC calls
  content = content.replace(/\.rpc\('filter_contacts_by_tags'/g, ".rpc('filter_contacts_by_collections'");
  
  // Column names mapped to the new DB names when doing selects or inserts
  // This is tricky because UI state might still be 'tag_id'.
  // We'll replace exact DB object keys:
  content = content.replace(/tag_id:/g, "collection_id:");
  content = content.replace(/tag_id,/g, "collection_id,");
  content = content.replace(/tag_id'/g, "collection_id'");
  content = content.replace(/tag_id"/g, 'collection_id"');
  content = content.replace(/'tag_id'/g, "'collection_id'");
  content = content.replace(/"tag_id"/g, '"collection_id"');
  
  content = content.replace(/flow_run_id:/g, "session_id:");
  content = content.replace(/flow_run_id,/g, "session_id,");
  content = content.replace(/flow_run_id'/g, "session_id'");
  content = content.replace(/'flow_run_id'/g, "'session_id'");

  // Also catch select('..., tag_id')
  content = content.replace(/select\('tag_id'\)/g, "select('collection_id')");
  content = content.replace(/select\('contact_id, tag_id'\)/g, "select('contact_id, collection_id')");

  // .eq('tag_id', ...) -> .eq('collection_id', ...)
  content = content.replace(/\.eq\('tag_id'/g, ".eq('collection_id'");
  content = content.replace(/\.in\('tag_id'/g, ".in('collection_id'");

  // .eq('flow_run_id', ...) -> .eq('session_id', ...)
  content = content.replace(/\.eq\('flow_run_id'/g, ".eq('session_id'");

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
  }
});
