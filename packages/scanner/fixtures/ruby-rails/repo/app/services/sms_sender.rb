class SmsSender
  def initialize
    @client = Twilio::REST::Client.new(ENV["TWILIO_ACCOUNT_SID"], ENV["TWILIO_AUTH_TOKEN"])
  end

  def send_code(to, code)
    @client.messages.create(from: ENV["TWILIO_PHONE_NUMBER"], to: to, body: "Your code is #{code}")
  end
end
