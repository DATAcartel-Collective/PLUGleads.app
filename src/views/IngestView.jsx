import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ROOFING_PHYSICS } from '../lib/roofingAnimations';
import { supabase } from '../lib/supabaseClient';
import { cullingGetLeadsByTenant } from '../lib/supabaseRPC';
import { runFullCullingPass, writeCullingResults } from '../lib/cullingEngine';

export default function IngestView() {
  const [tenantId, setTenantId] = useState('');
  // --- PROPWIRE STATE ---
  const [parsedLeads, setParsedLeads] = useState([]);
  const [validLeads, setValidLeads] = useState([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [autoTier3Count, setAutoTier3Count] = useState(0);
  const [fileName, setFileName] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const progressBarRef = useRef(null);

  // --- PERMIT STATE ---
  const [permitParsedLeads, setPermitParsedLeads] = useState([]);
  const [permitValidLeads, setPermitValidLeads] = useState([]);
  const [permitFileName, setPermitFileName] = useState('');
  const [isPermitParsing, setIsPermitParsing] = useState(false);
  const [permitDropKey, setPermitDropKey] = useState(0);
  const [isPermitUploading, setIsPermitUploading] = useState(false);
  const [permitUploadProgress, setPermitUploadProgress] = useState(0);
  const [permitUploadError, setPermitUploadError] = useState(null);
  const [permitUploadSuccess, setPermitUploadSuccess] = useState(false);
  const permitProgressBarRef = useRef(null);

  // --- INGESTION LOG STATE ---
  const [ingestionLog, setIngestionLog] = useState([]);
  const [isFetchingLog, setIsFetchingLog] = useState(true);

  // --- CULLING ENGINE STATE ---
  const [isCulling, setIsCulling] = useState(false);
  const [cullingProgress, setCullingProgress] = useState(0);
  const [cullingResults, setCullingResults] = useState(null);
  const cullingProgressBarRef = useRef(null);

  const fetchLog = async () => {
    setIsFetchingLog(true);
    const { data, error } = await supabase
      .from('leads')
      .select('created_at, address, priority_status, lead_score')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error || !data) {
      setIngestionLog([]);
    } else {
      setIngestionLog(data);
    }
    setIsFetchingLog(false);
  };

  useEffect(() => {
    fetchLog();
  }, []);

  const handleCulling = async () => {
    if (!tenantId) return;
    setIsCulling(true);
    setCullingProgress(10);
    setCullingResults(null);

    try {
      // 1. Fetch leads
      const leads = await cullingGetLeadsByTenant(tenantId);
      setCullingProgress(30);

      // 2. Fetch hail events
      const { data: hailEvents, error } = await supabase.from('hail_events').select('*');
      if (error) throw error;
      setCullingProgress(50);

      // 3. Run culling pass
      const updatedLeads = await runFullCullingPass(leads, hailEvents || [], tenantId);
      setCullingProgress(70);

      // 4. Write results
      await writeCullingResults(updatedLeads);
      setCullingProgress(100);

      // Calculate summary
      const summary = {
        total: updatedLeads.length,
        tier1: updatedLeads.filter(l => l.priority_status === 'Tier 1').length,
        tier2: updatedLeads.filter(l => l.priority_status === 'Tier 2').length,
        tier3: updatedLeads.filter(l => l.priority_status === 'Tier 3').length,
        autoTier3: updatedLeads.filter(l => l.auto_tier3_reason).length,
        expiredStatute: updatedLeads.filter(l => l.statute_reason === 'Statute window expired').length,
        hotStorm: updatedLeads.filter(l => l.is_hot_storm_lead).length,
      };
      setCullingResults(summary);

      // 5. Refresh log
      fetchLog();
    } catch (err) {
      console.error("Culling error:", err);
    } finally {
      setIsCulling(false);
    }
  };

  useEffect(() => {
    if (isCulling && cullingProgressBarRef.current) {
      gsap.to(cullingProgressBarRef.current, { width: cullingProgress + '%', duration: 0.3 });
    }
  }, [cullingProgress, isCulling]);

  const safeDate = (val) => {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  const parseNum = (val) => {
    if (!val) return 0;
    const parsed = parseFloat(val.toString().replace(/[$,%]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  };

  const mapRow = (row, tId) => {
    return {
      tenant_id: tId,
      address: row['Address'] || null,
      city: row['City'] || null,
      state: row['State'] || null,
      zip_code: row['Zip'] || null,
      latitude: parseFloat(row['Latitude']) || null,
      longitude: parseFloat(row['Longitude']) || null,
      homeowner_name: row['Owner Name'] || null,
      absentee_owner: row['Absentee Owner'] === 'Yes',
      mailing_address: row['Mailing Address'] || null,
      years_owned: parseInt(row['Years Owned'], 10) || 0,
      year_built: parseInt(row['Year Built'], 10) || null,
      square_footage: parseInt(row['Square Footage'], 10) || null,
      property_type: row['Property Type'] || null,
      assessed_value: parseNum(row['Assessed Value']),
      equity_percent: parseNum(row['Equity %']),
      last_sale_date: safeDate(row['Last Sale Date']),
      last_mortgage_date: safeDate(row['Last Mortgage Date']),
      mortgage_lender: row['Mortgage Lender'] || null,
      ltv_ratio: parseNum(row['LTV Ratio']) || null,
      has_llc_at_address: row['LLC at Address'] === 'Yes',
      has_occupational_license: row['Occupational License'] === 'Yes',
      is_hecm_reverse_mortgage: row['Reverse Mortgage'] === 'Yes',
      is_trust_owned: row['Trust Owned'] === 'Yes',
      has_tax_delinquency: row['Tax Delinquent'] === 'Yes',
      has_mechanic_lien: row['Mechanic Lien'] === 'Yes',
      has_code_violations: row['Code Violations'] === 'Yes',
      is_listed_for_sale: row['Listed For Sale'] === 'Yes',
      listing_date: safeDate(row['Listing Date']),
      last_storm_date: safeDate(row['Last Storm Date']),
    };
  };

  const onDrop = useCallback((acceptedFiles) => {
    if (!tenantId) return;
    const file = acceptedFiles[0];
    if (!file) return;
    
    setFileName(file.name);
    setIsParsing(true);
    setDropKey(prev => prev + 1);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const mapped = results.data.map(row => mapRow(row, tenantId));
        
        const valid = mapped.filter(r => r.address && r.state && r.latitude && r.longitude);
        const skipped = mapped.length - valid.length;
        const autoT3 = mapped.filter(r => r.has_tax_delinquency || r.has_mechanic_lien).length;
        
        setParsedLeads(mapped);
        setValidLeads(valid);
        setSkippedCount(skipped);
        setAutoTier3Count(autoT3);
        setIsParsing(false);
      }
    });
  }, [tenantId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'text/csv': ['.csv']
    },
    disabled: !tenantId || uploadSuccess
  });

  const handleUpload = async () => {
    if (!validLeads.length || !tenantId) return;
    
    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < validLeads.length; i += chunkSize) {
      chunks.push(validLeads.slice(i, i + chunkSize));
    }

    let currentProgress = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { error } = await supabase.from('leads').upsert(chunk, { onConflict: 'address' });
      
      if (error) {
        setUploadError(error.message || 'An error occurred during upload.');
        setIsUploading(false);
        return;
      }
      
      currentProgress = Math.round(((i + 1) / chunks.length) * 100);
      setUploadProgress(currentProgress);
    }

    setUploadSuccess(true);
    setIsUploading(false);
    fetchLog();
  };

  useEffect(() => {
    if (isUploading && progressBarRef.current) {
      gsap.to(progressBarRef.current, { width: uploadProgress + '%', duration: 0.3 });
    }
  }, [uploadProgress, isUploading]);

  const handleReset = () => {
    setParsedLeads([]);
    setValidLeads([]);
    setSkippedCount(0);
    setAutoTier3Count(0);
    setFileName('');
    setUploadSuccess(false);
    setUploadError(null);
    setUploadProgress(0);
    setDropKey(prev => prev + 1);
  };

  // --- PERMIT LOGIC ---
  const normalizePermitType = (raw) => {
    if (!raw) return "OTHER";
    const lower = raw.toLowerCase();
    if (lower.includes("roof")) return "ROOFING";
    if (lower.includes("pool")) return "POOL";
    if (lower.includes("deck")) return "DECK";
    if (lower.includes("concrete") || lower.includes("patio") || lower.includes("stamped")) return "CONCRETE";
    if (lower.includes("driveway")) return "DRIVEWAY";
    if (lower.includes("fence")) return "FENCE";
    if (lower.includes("gazebo")) return "GAZEBO";
    if (lower.includes("basket")) return "BASKETBALL_HOOP";
    if (lower.includes("retaining") || lower.includes("wall")) return "RETAINING_WALL";
    return "OTHER";
  };

  const getPermitBadgeColor = (type) => {
    switch (type) {
      case 'ROOFING': return 'bg-cyan-900/50 text-cyan-400';
      case 'POOL': return 'bg-blue-900/50 text-blue-400';
      case 'DECK': return 'bg-green-900/50 text-green-400';
      case 'CONCRETE': return 'bg-yellow-900/50 text-yellow-400';
      case 'DRIVEWAY': return 'bg-orange-900/50 text-orange-400';
      case 'FENCE': return 'bg-purple-900/50 text-purple-400';
      case 'GAZEBO': return 'bg-pink-900/50 text-pink-400';
      case 'BASKETBALL_HOOP': return 'bg-red-900/50 text-red-400';
      case 'RETAINING_WALL': return 'bg-zinc-700 text-zinc-300';
      default: return 'bg-gray-800 text-gray-400';
    }
  };

  const mapPermitRow = (row, tId, sourceFile) => {
    const status = row['Status']?.toUpperCase();
    const isClosed = status === 'CLOSED' || status === 'FINALED';
    
    return {
      tenant_id: tId,
      permit_number: row['Permit Number'] || null,
      permit_type: normalizePermitType(row['Permit Type']),
      permit_description: row['Description'] || null,
      issue_date: safeDate(row['Issue Date']),
      closed_date: safeDate(row['Closed Date']),
      is_closed: isClosed,
      address: row['Address'] || null,
      city: row['City'] || null,
      state: row['State'] || null,
      zip_code: row['Zip'] || null,
      latitude: parseFloat(row['Latitude']) || null,
      longitude: parseFloat(row['Longitude']) || null,
      source_file: sourceFile
    };
  };

  const onPermitDrop = useCallback((acceptedFiles) => {
    if (!tenantId) return;
    const file = acceptedFiles[0];
    if (!file) return;
    
    setPermitFileName(file.name);
    setIsPermitParsing(true);
    setPermitDropKey(prev => prev + 1);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const mapped = results.data.map(row => mapPermitRow(row, tenantId, file.name));
        // For permits, we just need a permit number to upsert
        const valid = mapped.filter(r => r.permit_number);
        
        setPermitParsedLeads(mapped);
        setPermitValidLeads(valid);
        setIsPermitParsing(false);
      }
    });
  }, [tenantId]);

  const { getRootProps: getPermitRootProps, getInputProps: getPermitInputProps, isDragActive: isPermitDragActive } = useDropzone({ 
    onDrop: onPermitDrop,
    accept: {
      'text/csv': ['.csv']
    },
    disabled: !tenantId || permitUploadSuccess
  });

  const handlePermitUpload = async () => {
    if (!permitValidLeads.length || !tenantId) return;
    
    setIsPermitUploading(true);
    setPermitUploadError(null);
    setPermitUploadProgress(0);
    
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < permitValidLeads.length; i += chunkSize) {
      chunks.push(permitValidLeads.slice(i, i + chunkSize));
    }

    let currentProgress = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { error } = await supabase.from('permits').upsert(chunk, { onConflict: 'permit_number' });
      
      if (error) {
        setPermitUploadError(error.message || 'An error occurred during permit upload.');
        setIsPermitUploading(false);
        return;
      }
      
      currentProgress = Math.round(((i + 1) / chunks.length) * 100);
      setPermitUploadProgress(currentProgress);
    }

    // Lead linking stub
    try {
      await supabase.rpc('link_permits_to_leads');
    } catch (e) {
      // Catch silently as requested
    }

    setPermitUploadSuccess(true);
    setIsPermitUploading(false);
    fetchLog();
  };

  useEffect(() => {
    if (isPermitUploading && permitProgressBarRef.current) {
      gsap.to(permitProgressBarRef.current, { width: permitUploadProgress + '%', duration: 0.3 });
    }
  }, [permitUploadProgress, isPermitUploading]);

  const handlePermitReset = () => {
    setPermitParsedLeads([]);
    setPermitValidLeads([]);
    setPermitFileName('');
    setPermitUploadSuccess(false);
    setPermitUploadError(null);
    setPermitUploadProgress(0);
    setPermitDropKey(prev => prev + 1);
  };

  return (
    <div className="p-6 font-mono text-white max-w-7xl mx-auto">
      {/* TENANT ID INPUT */}
      <div className="mb-6 flex items-center space-x-3">
        <label className="text-[#06b6d4] font-mono font-bold text-sm">TENANT ID</label>
        <input 
          data-testid="tenant-id-input"
          type="text" 
          placeholder="Paste tenant UUID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          disabled={uploadSuccess || isUploading || permitUploadSuccess || isPermitUploading}
          className="bg-zinc-800 border border-transparent focus:border-[#06b6d4] text-white font-mono px-3 py-1 rounded outline-none w-80 disabled:opacity-50"
        />
      </div>

      {/* GRID LAYOUT */}
      <div data-testid="ingest-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* ========================================== */}
        {/* PROPWIRE PANEL */}
        {/* ========================================== */}
        <div className="flex flex-col">

      {/* DRAG AND DROP ZONE */}
      {!uploadSuccess && (
        <motion.div 
          key={dropKey}
          variants={dropKey > 0 ? ROOFING_PHYSICS.bundleDrop : {}}
          initial={dropKey > 0 ? "initial" : false}
          animate={dropKey > 0 ? "animate" : false}
        >
          <div 
            {...getRootProps()} 
            data-testid="propwire-dropzone"
            title={!tenantId ? "Enter Tenant ID to upload" : ""}
            className={`
              texture-plywood border-2 border-dashed rounded-lg p-12 text-center transition-colors duration-200
              ${!tenantId || isUploading ? 'opacity-50 cursor-not-allowed border-zinc-700' : isDragActive ? 'border-[#06b6d4] bg-zinc-800/50 cursor-pointer' : 'border-[#06b6d4]/50 hover:border-[#06b6d4] cursor-pointer'}
            `}
          >
            <input {...getInputProps()} />
            <p className="text-[#06b6d4] uppercase font-bold text-xl tracking-wider">
              {isParsing ? 'PARSING...' : fileName ? `LOADED: ${fileName}` : 'DROP PROPWIRE CSV'}
            </p>
            {!tenantId && <p className="text-red-400 mt-2 text-sm">Tenant ID required</p>}
          </div>
        </motion.div>
      )}

      {/* PREVIEW TABLE & VALIDATION */}
      {parsedLeads.length > 0 && !uploadSuccess && (
        <div className="mt-8">
          <div className="mb-4 inline-block bg-zinc-900 border border-[#06b6d4] text-[#06b6d4] px-3 py-1 rounded text-sm font-bold">
            {parsedLeads.length} RECORDS PARSED
          </div>

          <div className="overflow-x-auto bg-zinc-800 border border-zinc-700 rounded-lg">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-[#06b6d4] border-b border-zinc-700">
                <tr>
                  <th className="p-3">Address</th>
                  <th className="p-3">Owner Name</th>
                  <th className="p-3">State</th>
                  <th className="p-3">Assessed Value</th>
                  <th className="p-3">Equity %</th>
                  <th className="p-3">Storm Date</th>
                  <th className="p-3">Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700">
                {parsedLeads.slice(0, 10).map((lead, idx) => (
                  <tr key={idx} className="hover:bg-zinc-700/50">
                    <td className="p-3 truncate max-w-xs">{lead.address}</td>
                    <td className="p-3">{lead.homeowner_name}</td>
                    <td className="p-3">{lead.state}</td>
                    <td className="p-3">${lead.assessed_value?.toLocaleString()}</td>
                    <td className="p-3">{lead.equity_percent}%</td>
                    <td className="p-3">{lead.last_storm_date ? new Date(lead.last_storm_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${lead.has_tax_delinquency || lead.has_mechanic_lien ? 'bg-red-900/50 text-red-400' : 'bg-zinc-700 text-zinc-300'}`}>
                        {lead.has_tax_delinquency || lead.has_mechanic_lien ? 'Tier 3 (Auto)' : 'Tier 3'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsedLeads.length > 10 && (
            <div className="text-zinc-500 text-xs mt-2 text-center">Showing first 10 rows...</div>
          )}

          {/* VALIDATION SUMMARY PANEL */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-900 border border-green-500/30 rounded p-4 flex flex-col items-center justify-center">
              <span className="text-green-400 text-2xl font-bold">{validLeads.length}</span>
              <span className="text-zinc-400 text-xs mt-1 uppercase">✅ Valid Rows</span>
            </div>
            <div className="bg-zinc-900 border border-yellow-500/30 rounded p-4 flex flex-col items-center justify-center">
              <span className="text-yellow-400 text-2xl font-bold">{skippedCount}</span>
              <span className="text-zinc-400 text-xs mt-1 uppercase">⚠️ Skipped Rows</span>
            </div>
            <div className="bg-zinc-900 border border-red-500/30 rounded p-4 flex flex-col items-center justify-center">
              <span className="text-red-400 text-2xl font-bold">{autoTier3Count}</span>
              <span className="text-zinc-400 text-xs mt-1 uppercase">🔴 Auto Tier 3</span>
            </div>
          </div>
        </div>
      )}

      {/* UPLOAD BUTTON & PROGRESS */}
      {validLeads.length > 0 && tenantId && !uploadSuccess && (
        <div className="mt-8">
          <motion.button
            whileTap={!isUploading && tenantId ? ROOFING_PHYSICS.nailGunRecoil.whileTap : {}}
            onClick={handleUpload}
            disabled={isUploading || !tenantId}
            title={!tenantId ? "Enter Tenant ID to upload" : ""}
            className={`w-full py-4 text-xl font-bold uppercase rounded border-2 transition-colors duration-200 flex justify-center items-center
              ${isUploading || !tenantId
                ? 'bg-zinc-800 border-zinc-600 text-zinc-400 cursor-not-allowed' 
                : 'bg-zinc-800 border-[#06b6d4] text-[#06b6d4] hover:bg-zinc-700'
              }
            `}
          >
            {isUploading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-[#06b6d4]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                UPLOADING... {uploadProgress}%
              </span>
            ) : (
              `NAIL IT — UPLOAD ${validLeads.length} LEADS`
            )}
          </motion.button>
          
          {/* GSAP PROGRESS BAR */}
          <div className={`w-full bg-zinc-800 mt-2 rounded overflow-hidden transition-opacity duration-300 ${isUploading ? 'opacity-100 h-1' : 'opacity-0 h-1'}`}>
            <div 
              ref={progressBarRef}
              data-testid="upload-progress-bar"
              className="h-full bg-[#06b6d4]" 
              style={{ width: '0%' }}
            />
          </div>

          {/* ERROR STATE */}
          {uploadError && (
            <div className="mt-4 bg-zinc-900 border border-red-500 rounded p-4 flex flex-col items-center">
              <h3 className="text-red-500 font-bold text-lg mb-2">UPLOAD FAILED</h3>
              <p className="text-red-400 text-sm mb-4 text-center">{uploadError}</p>
              <button 
                onClick={handleUpload}
                className="bg-red-900/50 text-red-400 border border-red-500 px-6 py-2 rounded font-bold hover:bg-red-900 transition-colors"
              >
                RETRY
              </button>
            </div>
          )}
        </div>
      )}

      {/* SUCCESS STATE */}
      {uploadSuccess && (
        <div className="mt-8 flex flex-col items-center">
          <div className="w-full py-4 text-xl font-bold uppercase rounded border-2 bg-zinc-800 border-green-500 text-green-500 flex justify-center items-center mb-6">
            ✓ {validLeads.length} LEADS NAILED
          </div>

          <div className="bg-zinc-900 border border-green-500/50 rounded-lg p-6 w-full max-w-2xl text-center">
            <h3 className="text-green-400 font-bold text-2xl mb-4">UPLOAD COMPLETE</h3>
            <div className="grid grid-cols-2 gap-4 mb-6 text-left">
              <div className="bg-zinc-800 p-3 rounded">
                <div className="text-zinc-400 text-xs uppercase">Total Uploaded</div>
                <div className="text-white font-bold text-lg">{validLeads.length}</div>
              </div>
              <div className="bg-zinc-800 p-3 rounded">
                <div className="text-zinc-400 text-xs uppercase">Auto Tier 3</div>
                <div className="text-white font-bold text-lg">{autoTier3Count}</div>
              </div>
              <div className="bg-zinc-800 p-3 rounded col-span-2">
                <div className="text-zinc-400 text-xs uppercase">Timestamp</div>
                <div className="text-white font-bold">{new Date().toLocaleString()}</div>
              </div>
            </div>
            <div className="text-[#06b6d4] opacity-50 text-sm font-bold tracking-widest mb-6">
              READY FOR GEOSPATIAL CULLING →
            </div>
            <button 
              onClick={handleReset}
              className="bg-zinc-800 text-white border border-zinc-600 px-6 py-3 rounded font-bold hover:bg-zinc-700 transition-colors w-full"
            >
              UPLOAD NEW FILE
            </button>
          </div>
        </div>
      )}
      </div>

        {/* ========================================== */}
        {/* PERMIT PANEL */}
        {/* ========================================== */}
        <div className="flex flex-col">
          {!permitUploadSuccess && (
            <motion.div 
              key={`permit-${permitDropKey}`}
              variants={permitDropKey > 0 ? ROOFING_PHYSICS.bundleDrop : {}}
              initial={permitDropKey > 0 ? "initial" : false}
              animate={permitDropKey > 0 ? "animate" : false}
            >
              <div 
                {...getPermitRootProps()} 
                data-testid="permit-dropzone"
                title={!tenantId ? "Enter Tenant ID to upload" : ""}
                className={`
                  texture-plywood border-2 border-dashed rounded-lg p-12 text-center transition-colors duration-200
                  ${!tenantId || isPermitUploading ? 'opacity-50 cursor-not-allowed border-zinc-700' : isPermitDragActive ? 'border-[#06b6d4] bg-zinc-800/50 cursor-pointer' : 'border-[#06b6d4]/50 hover:border-[#06b6d4] cursor-pointer'}
                `}
              >
                <input {...getPermitInputProps()} />
                <p className="text-[#06b6d4] uppercase font-bold text-xl tracking-wider">
                  {isPermitParsing ? 'PARSING...' : permitFileName ? `LOADED: ${permitFileName}` : 'DROP COUNTY PERMIT CSV'}
                </p>
                {!tenantId && <p className="text-red-400 mt-2 text-sm">Tenant ID required</p>}
              </div>
            </motion.div>
          )}

          {permitParsedLeads.length > 0 && !permitUploadSuccess && (
            <div className="mt-8">
              <div className="mb-4 inline-block bg-zinc-900 border border-[#06b6d4] text-[#06b6d4] px-3 py-1 rounded text-sm font-bold">
                {permitParsedLeads.length} PERMITS PARSED
              </div>

              <div className="overflow-x-auto bg-zinc-800 border border-zinc-700 rounded-lg">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-900 text-[#06b6d4] border-b border-zinc-700">
                    <tr>
                      <th className="p-3">Address</th>
                      <th className="p-3">Permit Type</th>
                      <th className="p-3">Issue Date</th>
                      <th className="p-3">Closed</th>
                      <th className="p-3">Source File</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-700">
                    {permitParsedLeads.slice(0, 10).map((permit, idx) => (
                      <tr key={idx} className="hover:bg-zinc-700/50">
                        <td className="p-3 truncate max-w-[120px]">{permit.address}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${getPermitBadgeColor(permit.permit_type)}`}>
                            {permit.permit_type}
                          </span>
                        </td>
                        <td className="p-3">{permit.issue_date ? new Date(permit.issue_date).toLocaleDateString() : 'N/A'}</td>
                        <td className="p-3">
                          {permit.is_closed ? <span className="text-green-400">Yes</span> : <span className="text-red-400">No</span>}
                        </td>
                        <td className="p-3 truncate max-w-[100px] text-zinc-400">{permit.source_file}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {permitParsedLeads.length > 10 && (
                <div className="text-zinc-500 text-xs mt-2 text-center">Showing first 10 rows...</div>
              )}
            </div>
          )}

          {permitValidLeads.length > 0 && tenantId && !permitUploadSuccess && (
            <div className="mt-8">
              <motion.button
                whileTap={!isPermitUploading && tenantId ? ROOFING_PHYSICS.nailGunRecoil.whileTap : {}}
                onClick={handlePermitUpload}
                disabled={isPermitUploading || !tenantId}
                title={!tenantId ? "Enter Tenant ID to upload" : ""}
                className={`w-full py-4 text-xl font-bold uppercase rounded border-2 transition-colors duration-200 flex justify-center items-center
                  ${isPermitUploading || !tenantId
                    ? 'bg-zinc-800 border-zinc-600 text-zinc-400 cursor-not-allowed' 
                    : 'bg-zinc-800 border-[#06b6d4] text-[#06b6d4] hover:bg-zinc-700'
                  }
                `}
              >
                {isPermitUploading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-[#06b6d4]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    UPLOADING... {permitUploadProgress}%
                  </span>
                ) : (
                  `NAIL IT — UPLOAD ${permitValidLeads.length} PERMITS`
                )}
              </motion.button>
              
              <div className={`w-full bg-zinc-800 mt-2 rounded overflow-hidden transition-opacity duration-300 ${isPermitUploading ? 'opacity-100 h-1' : 'opacity-0 h-1'}`}>
                <div 
                  ref={permitProgressBarRef}
                  data-testid="permit-progress-bar"
                  className="h-full bg-[#06b6d4]" 
                  style={{ width: '0%' }}
                />
              </div>

              {permitUploadError && (
                <div className="mt-4 bg-zinc-900 border border-red-500 rounded p-4 flex flex-col items-center">
                  <h3 className="text-red-500 font-bold text-lg mb-2">UPLOAD FAILED</h3>
                  <p className="text-red-400 text-sm mb-4 text-center">{permitUploadError}</p>
                  <button 
                    onClick={handlePermitUpload}
                    className="bg-red-900/50 text-red-400 border border-red-500 px-6 py-2 rounded font-bold hover:bg-red-900 transition-colors"
                  >
                    RETRY
                  </button>
                </div>
              )}
            </div>
          )}

          {permitUploadSuccess && (
            <div className="mt-8 flex flex-col items-center">
              <div className="w-full py-4 text-xl font-bold uppercase rounded border-2 bg-zinc-800 border-green-500 text-green-500 flex justify-center items-center mb-6">
                ✓ {permitValidLeads.length} PERMITS NAILED
              </div>

              <div className="bg-zinc-900 border border-green-500/50 rounded-lg p-6 w-full text-center">
                <h3 className="text-green-400 font-bold text-2xl mb-4">UPLOAD COMPLETE</h3>
                <div className="grid grid-cols-1 gap-4 mb-6 text-left">
                  <div className="bg-zinc-800 p-3 rounded">
                    <div className="text-zinc-400 text-xs uppercase">Total Uploaded</div>
                    <div className="text-white font-bold text-lg">{permitValidLeads.length}</div>
                  </div>
                  <div className="bg-zinc-800 p-3 rounded">
                    <div className="text-zinc-400 text-xs uppercase">Timestamp</div>
                    <div className="text-white font-bold">{new Date().toLocaleString()}</div>
                  </div>
                </div>
                <button 
                  onClick={handlePermitReset}
                  className="bg-zinc-800 text-white border border-zinc-600 px-6 py-3 rounded font-bold hover:bg-zinc-700 transition-colors w-full"
                >
                  UPLOAD NEW FILE
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* INGESTION HISTORY LOG */}
      <div data-testid="ingestion-log" className="mt-8 bg-zinc-900 border border-zinc-800 rounded p-4">
        <h2 className="text-[#06b6d4] uppercase font-mono text-[12px] mb-4">RECENT INGESTION LOG</h2>
        <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
          {isFetchingLog ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} data-testid="log-skeleton" className="animate-pulse bg-zinc-800 rounded h-4 w-full"></div>
            ))
          ) : ingestionLog.length === 0 ? (
            <div className="text-center text-zinc-500 py-4">NO LEADS INGESTED YET</div>
          ) : (
            ingestionLog.map((log, i) => (
              <div key={i} className="flex items-center justify-between bg-zinc-800/50 p-2 rounded text-sm">
                <div className="flex items-center space-x-4">
                  <span className="text-zinc-500">{new Date(log.created_at).toLocaleString()}</span>
                  <span className="text-zinc-300 truncate max-w-[200px]">{log.address}</span>
                </div>
                <div className="flex items-center space-x-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    log.priority_status === 'Tier 1' ? 'bg-green-900/50 text-green-400' :
                    log.priority_status === 'Tier 2' ? 'bg-yellow-900/50 text-yellow-400' :
                    'bg-zinc-700 text-zinc-300'
                  }`}>
                    {log.priority_status || 'Tier 3'}
                  </span>
                  <span className="text-zinc-400 w-12 text-right">{log.lead_score || 0}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CULLING ENGINE PANEL */}
      <div data-testid="culling-panel" className="mt-8 bg-zinc-900 border border-zinc-800 rounded p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-[#06b6d4] font-mono tracking-tight">GEOSPATIAL CULLING ENGINE</h2>
          <p className="text-sm text-zinc-500 font-mono">Phase 2 — Zero Cost Statute & Swath Validation</p>
        </div>

        <motion.button
          whileTap={(!isCulling && tenantId) ? ROOFING_PHYSICS.nailGunRecoil.whileTap : {}}
          onClick={handleCulling}
          disabled={isCulling || !tenantId}
          data-testid="run-culling-btn"
          className={`w-full py-4 text-xl font-bold uppercase rounded border-2 transition-colors duration-200 flex justify-center items-center font-mono
            ${(isCulling || !tenantId)
              ? 'bg-zinc-800 border-zinc-600 text-zinc-400 cursor-not-allowed' 
              : 'bg-zinc-800 border-[#06b6d4] text-[#06b6d4] hover:bg-zinc-700'
            }
          `}
        >
          {isCulling ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-[#06b6d4]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              CULLING... {cullingProgress}%
            </span>
          ) : (
            `RUN CULLING PASS`
          )}
        </motion.button>

        <div className={`w-full bg-zinc-800 mt-2 rounded overflow-hidden transition-opacity duration-300 ${isCulling ? 'opacity-100 h-1' : 'opacity-0 h-1'}`}>
          <div 
            ref={cullingProgressBarRef}
            data-testid="culling-progress-bar"
            className="h-full bg-[#06b6d4]" 
            style={{ width: '0%' }}
          />
        </div>

        {cullingResults && (
          <div data-testid="culling-results" className="mt-6 bg-zinc-950 p-4 rounded border border-zinc-800 font-mono text-sm">
            <h3 className="text-zinc-300 font-bold mb-4 border-b border-zinc-800 pb-2">CULLING RESULTS SUMMARY</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">TOTAL PROCESSED</span>
                <span className="text-zinc-300 font-bold">{cullingResults.total}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">TIER 1</span>
                <span className="bg-green-900/50 text-green-400 px-2 py-0.5 rounded font-bold">{cullingResults.tier1}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">TIER 2</span>
                <span className="bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded font-bold">{cullingResults.tier2}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">TIER 3</span>
                <span className="bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded font-bold">{cullingResults.tier3}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">AUTO TIER 3 (FLAGS)</span>
                <span className="text-red-400 font-bold">{cullingResults.autoTier3}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">EXPIRED STATUTE</span>
                <span className="text-red-400 font-bold">{cullingResults.expiredStatute}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">HOT STORM LEADS</span>
                <span className="text-[#06b6d4] font-bold">{cullingResults.hotStorm}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
