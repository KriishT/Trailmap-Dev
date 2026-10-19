Rails.application.routes.draw do
  post "/verify", to: "verifications#create"
end
