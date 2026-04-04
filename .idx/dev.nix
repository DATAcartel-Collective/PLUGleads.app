{ pkgs, ... }: {
  channel = "stable-23.11";
  packages =[
    pkgs.nodejs_20
    pkgs.nodePackages.npm
  ];
  env = {
    VITE_SUPABASE_URL = "https://ylmsomkljcqcjpztslug.supabase.co";
    VITE_SUPABASE_ANON_KEY = "sb_publishable_cUd8snCxGcpaws7pRWgU2Q_VpaQb-jV";
    VITE_GEMINI_API_KEY = ""; 
    VITE_BATCHLEADS_API_KEY = "";
  };
  idx = {
    extensions =[
      "esbenp.prettier-vscode"
      "bradlc.vscode-tailwindcss"
    ];
    previews = {
      enable = true;
      previews = {
        web = {
          command =["npm" "run" "dev" "--" "--port" "5173" "--host" "0.0.0.0"];
          manager = "web";
        };
      };
    };
  };
}
