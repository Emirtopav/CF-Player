using System;
using System.Threading.Tasks;

namespace MusicPlayer.Helpers
{
    public static class TaskExtensions
    {
        public static async void FireAndForgetSafeAsync(this Task task, Action<Exception>? handler = null)
        {
            try
            {
                await task;
            }
            catch (Exception ex)
            {
                handler?.Invoke(ex);
            }
        }
    }
}
