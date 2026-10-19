using Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public class AppDbContext : DbContext
{
    public DbSet<Customer> Customers => Set<Customer>();
}
