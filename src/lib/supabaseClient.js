import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ylmsomkljcqcjpztslug.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_cUd8snCxGcpaws7pRWgU2Q_VpaQb-jV';

const rawClient = createClient(supabaseUrl, supabaseAnonKey);

const errorHandler = {
  get(target, prop, receiver) {
    const originalMethod = target[prop];
    if (typeof originalMethod === 'function') {
      return async function (...args) {
        try {
          const result = await originalMethod.apply(target, args);
          if (result && result.error) {
            if (result.error.code === '42501' || result.error.message?.toLowerCase().includes('rls')) {
              console.error("Auth required");
              result.error.message = "Auth required";
            } else {
              console.error("Supabase Error:", result.error);
            }
          }
          return result;
        } catch (error) {
          console.error("Supabase Exception:", error);
          return { data: null, error: { message: "Auth required" } };
        }
      };
    }
    return Reflect.get(target, prop, receiver);
  }
};

const proxyFrom = (client) => {
  const originalFrom = client.from.bind(client);
  client.from = (table) => {
    const builder = originalFrom(table);
    // Intercept select, insert, update, delete
    ['select', 'insert', 'update', 'delete', 'upsert'].forEach(method => {
       const orig = builder[method];
       if (orig) {
           builder[method] = (...args) => {
               const query = orig.apply(builder, args);
               const originalThen = query.then.bind(query);
               query.then = (onFulfilled, onRejected) => {
                   return originalThen(async (result) => {
                       if (result && result.error) {
                           if (result.error.code === '42501' || result.error.message?.toLowerCase().includes('rls') || result.error.message?.toLowerCase().includes('policy')) {
                               result.error = new Error("Auth required");
                               result.error.code = '42501';
                           } else {
                               console.error("Supabase Query Error:", result.error);
                           }
                       }
                       return onFulfilled ? onFulfilled(result) : result;
                   }, onRejected);
               };
               return query;
           };
       }
    });
    return builder;
  };
};

proxyFrom(rawClient);

export const supabase = rawClient;
