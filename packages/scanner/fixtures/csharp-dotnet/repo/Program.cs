var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("Default");
var app = builder.Build();

app.MapPost("/notify", async () =>
{
    using var http = new HttpClient();
    await http.PostAsync("https://api.mailgun.net/v3/acme.io/messages", null);
    return Results.Ok();
});

app.Run();
