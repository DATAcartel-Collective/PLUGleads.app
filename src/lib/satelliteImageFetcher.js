import axios from 'axios';

export async function fetchSatelliteImageAsBase64(latitude, longitude, zoom = 19, size = '640x640', apiKey) {
  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=${zoom}&size=${size}&maptype=satellite&key=${apiKey}`;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = window.btoa(
      new Uint8Array(response.data).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    return { base64, mimeType: 'image/png' };
  } catch (error) {
    return { base64: null, error: error.message };
  }
}

export async function fetchHistoricalImageAsBase64(latitude, longitude, apiKey) {
  try {
    // Uses zoom 18 to simulate historical comparison. Note: historical imagery requires Maps JS API or Street View API
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=18&size=640x640&maptype=satellite&key=${apiKey}`;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = window.btoa(
      new Uint8Array(response.data).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    return { base64, mimeType: 'image/png' };
  } catch (error) {
    return { base64: null, error: error.message };
  }
}
