import axios from 'axios';

export async function runSkipTrace(lead, apiKey) {
    try {
        const payload = {
            first_name: lead.homeowner_name?.split(' ')[0] || '',
            last_name: lead.homeowner_name?.split(' ').slice(1).join(' ') || '',
            address: lead.address,
            city: lead.city,
            state: lead.state,
            zip: lead.zip_code || ''
        };

        const response = await axios.post('https://api.batchleads.io/v2/skip-trace', payload, {
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            }
        });

        let rawPhones = [];
        if (response.data && response.data.phones) {
            rawPhones = response.data.phones;
        } else if (response.data && response.data.results && response.data.results[0] && response.data.results[0].phones) {
            rawPhones = response.data.results[0].phones;
        }

        const mappedArray = rawPhones.map(phone => ({
            number: phone.number,
            type: phone.type || 'unknown',
            carrier: phone.carrier || 'unknown'
        }));

        return { phones: mappedArray, rawResponse: response.data };
    } catch (error) {
        return { phones: [], error: error.message, rawResponse: null };
    }
}
