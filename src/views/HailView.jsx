import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { supabase } from '../lib/supabaseClient';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ROOFING_PHYSICS } from '../lib/roofingAnimations';

export default function HailView() {
  const [url, setUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [parsedEvents, setParsedEvents] = useState([]);
  const [fetchError, setFetchError] = useState(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const progressBarRef = useRef(null);

  const [hailEvents, setHailEvents] = useState([]);
  const [isFetchingEvents, setIsFetchingEvents] = useState(true);

  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [manualForm, setManualForm] = useState({
    event_date: '',
    state: '',
    county: '',
    hail_size_inches: '',
    wind_speed_mph: ''
  });

  const fetchExistingEvents = async () => {
    setIsFetchingEvents(true);
    const { data, error } = await supabase
      .from('hail_events')
      .select('id, event_date, state, county, hail_size_inches, wind_speed_mph, source_url')
      .order('event_date', { ascending: false })
      .limit(100);

    if (!error && data) {
      setHailEvents(data);
    }
    setIsFetchingEvents(false);
  };

  useEffect(() => {
    fetchExistingEvents();
  }, []);

  const handleFetchUrl = async () => {
    if (!url) return;
    setIsFetching(true);
    setFetchError(null);
    setParsedEvents([]);
    setUploadSuccess(false);

    try {
      const response = await axios.get(url);
      const geojson = response.data;

      if (!geojson || geojson.type !== 'FeatureCollection' || !geojson.features) {
        throw new Error('Invalid GeoJSON format. Expected FeatureCollection.');
      }

      const mapped = geojson.features.map(feature => {
        const props = feature.properties || {};
        const dateStr = props.DATE || props.date;
        let eventDate = null;
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) eventDate = d.toISOString();
        }

        return {
          event_date: eventDate,
          state: props.STATE || props.state || null,
          county: props.COUNTY || props.county || null,
          hail_size_inches: parseFloat(props.SIZE || props.size) || null,
          wind_speed_mph: parseFloat(props.SPEED || props.speed) || null,
          source_url: url,
          // Store the raw GeoJSON geometry object as a JSON string in a temp column
          // actual PostGIS geometry population handled by DB trigger
          temp_geom_json: JSON.stringify(feature.geometry)
        };
      });

      setParsedEvents(mapped);
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch or parse GeoJSON.');
    } finally {
      setIsFetching(false);
    }
  };

  const handleUpload = async () => {
    if (!parsedEvents.length) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < parsedEvents.length; i += chunkSize) {
      chunks.push(parsedEvents.slice(i, i + chunkSize));
    }

    let currentProgress = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { error } = await supabase.from('hail_events').upsert(chunk, { onConflict: 'source_url,event_date' });

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
    fetchExistingEvents();
  };

  useEffect(() => {
    if (isUploading && progressBarRef.current) {
      gsap.to(progressBarRef.current, { width: uploadProgress + '%', duration: 0.3 });
    }
  }, [uploadProgress, isUploading]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      event_date: manualForm.event_date ? new Date(manualForm.event_date).toISOString() : null,
      state: manualForm.state.toUpperCase(),
      county: manualForm.county,
      hail_size_inches: parseFloat(manualForm.hail_size_inches) || null,
      wind_speed_mph: parseFloat(manualForm.wind_speed_mph) || null,
      source_url: 'MANUAL_ENTRY'
    };

    const { error } = await supabase.from('hail_events').insert(payload);
    if (!error) {
      setManualForm({
        event_date: '',
        state: '',
        county: '',
        hail_size_inches: '',
        wind_speed_mph: ''
      });
      setIsManualExpanded(false);
      fetchExistingEvents();
    } else {
      window.alert('Error adding manual event: ' + error.message);
    }
  };

  return (
    <div className="p-6 font-mono text-white max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="mb-8">
        <h1 className="text-[#06b6d4] text-2xl font-bold uppercase tracking-wider">STORM SWATH INGESTION</h1>
        <p className="text-zinc-500 text-sm">NOAA SPC GeoJSON Pipeline</p>
      </div>

      {/* NOAA GEOJSON FETCH PANEL */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-[#06b6d4] font-mono font-bold text-sm mb-2">NOAA SPC GeoJSON URL</label>
            <input
              data-testid="noaa-url-input"
              type="text"
              placeholder="https://www.spc.noaa.gov/gis/svrgis/zipped/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isFetching || isUploading}
              className="w-full bg-zinc-800 border border-transparent focus:border-[#06b6d4] text-white font-mono px-3 py-2 rounded outline-none disabled:opacity-50"
            />
          </div>
          <motion.button
            whileTap={!isFetching && url ? ROOFING_PHYSICS.nailGunRecoil.whileTap : {}}
            onClick={handleFetchUrl}
            disabled={isFetching || !url || isUploading}
            className={`px-6 py-2 font-bold uppercase rounded border transition-colors duration-200 h-[42px] whitespace-nowrap
              ${isFetching || !url || isUploading
                ? 'bg-zinc-800 border-zinc-600 text-zinc-400 cursor-not-allowed'
                : 'bg-zinc-800 border-[#06b6d4] text-[#06b6d4] hover:bg-zinc-700'
              }
            `}
          >
            {isFetching ? 'FETCHING...' : 'FETCH SWATH DATA'}
          </motion.button>
        </div>

        {fetchError && (
          <div className="mt-4 text-red-400 text-sm">{fetchError}</div>
        )}
      </div>

      {/* GEOJSON TO SUPABASE */}
      <div className={`w-full bg-zinc-800 mt-2 rounded overflow-hidden transition-opacity duration-300 ${isUploading ? 'opacity-100 h-1' : 'opacity-0 h-1'}`}>
        <div
          ref={progressBarRef}
          data-testid="hail-progress-bar"
          className="h-full bg-[#06b6d4]"
          style={{ width: '0%' }}
        />
      </div>

      {parsedEvents.length > 0 && !uploadSuccess && (
        <div className="mb-8 mt-4">
          <div className="mb-4 inline-block bg-zinc-900 border border-[#06b6d4] text-[#06b6d4] px-3 py-1 rounded text-sm font-bold">
            {parsedEvents.length} STORM EVENTS PARSED
          </div>

          <motion.button
            whileTap={!isUploading ? ROOFING_PHYSICS.nailGunRecoil.whileTap : {}}
            onClick={handleUpload}
            disabled={isUploading}
            className={`w-full py-4 text-xl font-bold uppercase rounded border-2 transition-colors duration-200 flex justify-center items-center
              ${isUploading
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
              `NAIL IT — UPLOAD SWATHS`
            )}
          </motion.button>

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

      {uploadSuccess && (
        <div className="mb-8 flex flex-col items-center">
          <div className="w-full py-4 text-xl font-bold uppercase rounded border-2 bg-zinc-800 border-green-500 text-green-500 flex justify-center items-center mb-6">
            ✓ {parsedEvents.length} SWATHS NAILED
          </div>
          <button
            onClick={() => {
              setParsedEvents([]);
              setUploadSuccess(false);
              setUrl('');
            }}
            className="bg-zinc-800 text-white border border-zinc-600 px-6 py-3 rounded font-bold hover:bg-zinc-700 transition-colors"
          >
            FETCH ANOTHER URL
          </button>
        </div>
      )}

      {/* EXISTING SWATHS TABLE */}
      <div className="mb-8">
        <div className="mb-4 inline-block bg-zinc-900 border border-zinc-700 text-zinc-300 px-3 py-1 rounded text-sm font-bold">
          {hailEvents.length} STORM EVENTS ON RECORD
        </div>
        <div className="overflow-x-auto bg-zinc-800 border border-zinc-700 rounded-lg">
          <table data-testid="hail-events-table" className="w-full text-left text-sm">
            <thead className="bg-zinc-900 text-[#06b6d4] border-b border-zinc-700">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">State</th>
                <th className="p-3">County</th>
                <th className="p-3">Hail Size</th>
                <th className="p-3">Wind Speed</th>
                <th className="p-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700">
              {isFetchingEvents ? (
                <tr><td colSpan="6" className="p-4 text-center text-zinc-500">Loading...</td></tr>
              ) : hailEvents.length === 0 ? (
                <tr><td colSpan="6" className="p-4 text-center text-zinc-500">No storm events found.</td></tr>
              ) : (
                hailEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-zinc-700/50">
                    <td className="p-3">{ev.event_date ? new Date(ev.event_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="p-3">{ev.state}</td>
                    <td className="p-3">{ev.county}</td>
                    <td className="p-3">{ev.hail_size_inches ? `${ev.hail_size_inches}"` : '-'}</td>
                    <td className="p-3">{ev.wind_speed_mph ? `${ev.wind_speed_mph} mph` : '-'}</td>
                    <td className="p-3 truncate max-w-[200px] text-zinc-400" title={ev.source_url}>{ev.source_url}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MANUAL ENTRY FORM */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setIsManualExpanded(!isManualExpanded)}
          className="w-full p-4 text-left font-bold text-[#06b6d4] hover:bg-zinc-800 transition-colors flex justify-between items-center"
        >
          <span>ADD MANUAL STORM EVENT</span>
          <span>{isManualExpanded ? '−' : '+'}</span>
        </button>

        {isManualExpanded && (
          <form onSubmit={handleManualSubmit} className="p-6 border-t border-zinc-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-zinc-400 text-xs mb-1">Event Date</label>
              <input type="date" required value={manualForm.event_date} onChange={e => setManualForm({ ...manualForm, event_date: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 rounded focus:border-[#06b6d4] outline-none" />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1">State (2 chars)</label>
              <input type="text" maxLength={2} required value={manualForm.state} onChange={e => setManualForm({ ...manualForm, state: e.target.value.toUpperCase() })} className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 rounded focus:border-[#06b6d4] outline-none uppercase" />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1">County</label>
              <input type="text" required value={manualForm.county} onChange={e => setManualForm({ ...manualForm, county: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 rounded focus:border-[#06b6d4] outline-none" />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1">Hail Size (in)</label>
              <input type="number" step="0.25" value={manualForm.hail_size_inches} onChange={e => setManualForm({ ...manualForm, hail_size_inches: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 rounded focus:border-[#06b6d4] outline-none" />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1">Wind Speed (mph)</label>
              <input type="number" value={manualForm.wind_speed_mph} onChange={e => setManualForm({ ...manualForm, wind_speed_mph: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 text-white px-3 py-2 rounded focus:border-[#06b6d4] outline-none" />
            </div>
            <div className="lg:col-span-5 flex justify-end mt-2">
              <button type="submit" className="bg-zinc-800 border border-[#06b6d4] text-[#06b6d4] px-6 py-2 rounded font-bold hover:bg-zinc-700 transition-colors">
                ADD EVENT
              </button>
            </div>
          </form>
        )}
      </div>

    </div>
  );
}
