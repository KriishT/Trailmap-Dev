ActiveRecord::Schema[7.1].define(version: 2024_03_01_000000) do
  create_table "users", force: :cascade do |t|
    t.string "email"
    t.string "phone"
    t.string "nickname"
    t.datetime "created_at", null: false
  end
end
